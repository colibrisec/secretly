import { App, MessageEvent, SayFn } from '@slack/bolt';
// import { WebClient } from '@slack/web-api';
import { detectSensitiveData, detectHighEntropyStrings } from '../detectors/patterns';
import { ObfuscationService } from '../services/obfuscation.service';
import { AuditService } from '../services/audit.service';
import { PermissionService } from '../services/permission.service';
import { ChannelConfigService } from '../services/channel-config.service';
import { DatabaseService } from '../services/database.service';
import { RateLimiter } from '../utils/rate-limiter';
import { logger } from '../utils/logger';

export class MessageHandler {
  private obfuscationService: ObfuscationService;
  private auditService: AuditService;
  private permissionService: PermissionService;
  private channelConfigService: ChannelConfigService;
  private databaseService: DatabaseService;
  private rateLimiter: RateLimiter;
  private client: any;

  constructor(
    app: App,
    obfuscationService: ObfuscationService,
    auditService: AuditService,
    permissionService: PermissionService,
    channelConfigService: ChannelConfigService,
    databaseService: DatabaseService,
    rateLimiter: RateLimiter
  ) {
    this.obfuscationService = obfuscationService;
    this.auditService = auditService;
    this.permissionService = permissionService;
    this.channelConfigService = channelConfigService;
    this.databaseService = databaseService;
    this.rateLimiter = rateLimiter;
    this.client = app.client;
  }

  async handleMessage(event: MessageEvent, _say: SayFn): Promise<void> {
    try {
      if (!('text' in event) || !event.text || event.subtype === 'bot_message') {
        return;
      }

      const { channel, user, ts, text } = event as any;

      const rateLimitCheck = await this.rateLimiter.checkLimit(user, channel);
      if (!rateLimitCheck.allowed) {
        logger.warn(`Rate limit exceeded for user ${user} in channel ${channel}`);
        return;
      }

      const channelConfig = await this.channelConfigService.getChannelConfig(channel);
      if (!channelConfig.enabled) {
        return;
      }

      const isExempted = await this.permissionService.isUserExempted(user, channel);
      if (isExempted) {
        logger.info(`User ${user} is exempted from scanning in channel ${channel}`);
        return;
      }

      const detections = detectSensitiveData(text, channelConfig.enabledDetectors);
      
      const highEntropyStrings = channelConfig.detectHighEntropy 
        ? detectHighEntropyStrings(text, channelConfig.entropyThreshold)
        : [];

      if (detections.length === 0 && highEntropyStrings.length === 0) {
        return;
      }

      const matches = [
        ...detections.map(d => ({
          match: d.match,
          index: d.index,
          type: d.pattern.type,
          severity: d.pattern.severity,
          description: d.pattern.description
        })),
        ...highEntropyStrings.map(str => ({
          match: str,
          index: text.indexOf(str),
          type: 'high_entropy' as const,
          severity: 'medium' as const,
          description: 'High entropy string detected (possible secret)'
        }))
      ];

      const { obfuscated } = this.obfuscationService.obfuscateText(
        text,
        matches.map(m => ({ match: m.match, index: m.index, type: m.type }))
      );

      const recordId = this.obfuscationService.generateId();
      
      await this.databaseService.storeObfuscationRecord({
        id: recordId,
        messageTs: ts,
        channelId: channel,
        userId: user,
        originalContent: this.obfuscationService.encrypt(text),
        obfuscatedContent: obfuscated,
        detectionType: JSON.stringify(matches),
        severity: this.calculateOverallSeverity(matches),
        createdAt: new Date()
      });

      await this.client.chat.update({
        channel,
        ts,
        text: obfuscated
      });

      const detectionSummary = this.createDetectionSummary(matches);
      
      await this.client.chat.postEphemeral({
        channel,
        user,
        thread_ts: ts,
        text: this.createEphemeralMessage(detectionSummary, recordId),
        blocks: this.createEphemeralBlocks(detectionSummary, recordId, matches)
      });

      await this.auditService.logObfuscation({
        recordId,
        userId: user,
        channelId: channel,
        messageTs: ts,
        detections: matches,
        action: 'obfuscated',
        timestamp: new Date()
      });

      logger.info(`Obfuscated message from ${user} in ${channel} with ${matches.length} detections`);

    } catch (error) {
      logger.error('Error handling message:', error);
      
      await this.auditService.logError({
        userId: (event as any).user,
        channelId: (event as any).channel,
        messageTs: (event as any).ts,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      });
    }
  }

  async handleDismissal(recordId: string, userId: string): Promise<void> {
    try {
      const record = await this.databaseService.getObfuscationRecord(recordId);
      if (!record) {
        throw new Error('Obfuscation record not found');
      }

      const canDismiss = await this.permissionService.canUserDismiss(
        userId,
        record.channelId,
        record.severity
      );

      if (!canDismiss) {
        await this.client.chat.postEphemeral({
          channel: record.channelId,
          user: userId,
          text: '⚠️ You do not have permission to dismiss this obfuscation.'
        });
        return;
      }

      const originalText = this.obfuscationService.decrypt(record.originalContent);

      await this.client.chat.update({
        channel: record.channelId,
        ts: record.messageTs,
        text: originalText
      });

      await this.databaseService.markObfuscationDismissed(recordId, userId);

      await this.auditService.logDismissal({
        recordId,
        userId,
        channelId: record.channelId,
        messageTs: record.messageTs,
        dismissedBy: userId,
        timestamp: new Date()
      });

      await this.client.chat.postEphemeral({
        channel: record.channelId,
        user: userId,
        text: '✅ Obfuscation has been dismissed and original content restored.'
      });

    } catch (error) {
      logger.error('Error handling dismissal:', error);
      throw error;
    }
  }

  private calculateOverallSeverity(matches: Array<{ severity: string }>): string {
    const severityLevels = ['low', 'medium', 'high', 'critical'];
    let maxSeverity = 0;

    for (const match of matches) {
      const level = severityLevels.indexOf(match.severity);
      if (level > maxSeverity) {
        maxSeverity = level;
      }
    }

    return severityLevels[maxSeverity];
  }

  private createDetectionSummary(matches: Array<{ type: string }>): Map<string, number> {
    const summary = new Map<string, number>();
    
    for (const match of matches) {
      const count = summary.get(match.type) || 0;
      summary.set(match.type, count + 1);
    }

    return summary;
  }

  private createEphemeralMessage(summary: Map<string, number>, recordId: string): string {
    const items = Array.from(summary.entries())
      .map(([type, count]) => `• ${count} ${type.replace('_', ' ')}(s)`)
      .join('\\n');

    return `🔒 *Sensitive Data Detected and Obfuscated*\\n\\n${items}\\n\\nRecord ID: \`${recordId}\``;
  }

  private createEphemeralBlocks(
    summary: Map<string, number>,
    recordId: string,
    matches: Array<{ type: string; severity: string; description: string }>
  ): any[] {
    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🔒 Sensitive Data Detected',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Your message contained sensitive information that has been automatically obfuscated for security.'
        }
      },
      {
        type: 'section',
        fields: Array.from(summary.entries()).map(([type, count]) => ({
          type: 'mrkdwn',
          text: `*${type.replace('_', ' ').toUpperCase()}:* ${count}`
        }))
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Record ID: \`${recordId}\` | Severity: *${this.calculateOverallSeverity(matches)}*`
          }
        ]
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Dismiss Obfuscation',
              emoji: true
            },
            value: recordId,
            action_id: 'dismiss_obfuscation',
            style: 'danger',
            confirm: {
              title: {
                type: 'plain_text',
                text: 'Confirm Dismissal'
              },
              text: {
                type: 'mrkdwn',
                text: 'Are you sure you want to restore the original message with sensitive data?'
              },
              confirm: {
                type: 'plain_text',
                text: 'Yes, Restore Original'
              },
              deny: {
                type: 'plain_text',
                text: 'Cancel'
              }
            }
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View Guidelines',
              emoji: true
            },
            value: 'guidelines',
            action_id: 'view_guidelines'
          }
        ]
      }
    ];
  }
}