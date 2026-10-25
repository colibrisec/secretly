import { App, SayFn } from '@slack/bolt';
import { GenericMessageEvent } from '@slack/types';
import { detectSensitiveData, detectHighEntropyStrings } from '../detectors/patterns';
import { ObfuscationService } from '../services/obfuscation.service';
import { AuditService } from '../services/audit.service';
import { PermissionService } from '../services/permission.service';
import { ChannelConfigService } from '../services/channel-config.service';
import { DatabaseService } from '../services/database.service';
import { RateLimiter } from '../utils/rate-limiter';
import { logger } from '../utils/logger';
import * as metrics from '../utils/metrics';

/** The fields of a Slack message the handler needs. */
export interface ScannableMessage {
  channel: string;
  user: string;
  ts: string;
  text: string;
  thread_ts?: string;
}

/**
 * Turns a raw `message` event into something to scan, or null to ignore it.
 * New messages and edits (`message_changed`) are scanned; bot messages
 * (including our own reposts) and edits that leave the text alone, such as
 * link unfurls, are not.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toScannableMessage(event: any): ScannableMessage | null {
  if (!event || event.bot_id) {
    return null;
  }
  if (event.subtype === undefined) {
    if (!event.text || !event.user) {
      return null;
    }
    return { channel: event.channel, user: event.user, ts: event.ts, text: event.text, thread_ts: event.thread_ts };
  }
  if (event.subtype === 'message_changed') {
    const message = event.message;
    if (!message || message.bot_id || message.subtype || !message.text || !message.user) {
      return null;
    }
    if (event.previous_message?.text === message.text) {
      return null;
    }
    return { channel: event.channel, user: message.user, ts: message.ts, text: message.text, thread_ts: message.thread_ts };
  }
  return null;
}

/** Deletes messages on behalf of a workspace admin (user token). */
export interface AdminClient {
  chat: { delete(args: { channel: string; ts: string }): Promise<unknown> };
}

interface AuthorProfile {
  username?: string;
  iconUrl?: string;
}

const PROFILE_TTL_MS = 60 * 60 * 1000;

export class MessageHandler {
  private obfuscationService: ObfuscationService;
  private auditService: AuditService;
  private permissionService: PermissionService;
  private channelConfigService: ChannelConfigService;
  private databaseService: DatabaseService;
  private rateLimiter: RateLimiter;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private adminClient: AdminClient;
  private profiles = new Map<string, { profile: AuthorProfile; expires: number }>();

  constructor(
    app: App,
    obfuscationService: ObfuscationService,
    auditService: AuditService,
    permissionService: PermissionService,
    channelConfigService: ChannelConfigService,
    databaseService: DatabaseService,
    rateLimiter: RateLimiter,
    adminClient: AdminClient
  ) {
    this.obfuscationService = obfuscationService;
    this.auditService = auditService;
    this.permissionService = permissionService;
    this.channelConfigService = channelConfigService;
    this.databaseService = databaseService;
    this.rateLimiter = rateLimiter;
    this.client = app.client;
    this.adminClient = adminClient;
  }

  async handleMessage(event: GenericMessageEvent, _say: SayFn): Promise<void> {
    let endTimer: (() => number) | undefined;
    try {
      if (!('text' in event) || !event.text || event.subtype === 'bot_message') {
        return;
      }
      endTimer = metrics.messageDuration.startTimer();

      const { channel, user, ts, text } = event as any;
      const threadTs: string | undefined = (event as any).thread_ts;

      const rateLimitCheck = await this.rateLimiter.checkLimit(user, channel);
      if (!rateLimitCheck.allowed) {
        logger.warn(`Rate limit exceeded for user ${user} in channel ${channel}`);
        metrics.messagesSkipped.inc({ reason: 'rate_limited' });
        return;
      }

      const channelConfig = await this.channelConfigService.getChannelConfig(channel);
      if (!channelConfig.enabled) {
        metrics.messagesSkipped.inc({ reason: 'channel_disabled' });
        return;
      }

      const isExempted = await this.permissionService.isUserExempted(user, channel);
      if (isExempted) {
        logger.info(`User ${user} is exempted from scanning in channel ${channel}`);
        metrics.messagesSkipped.inc({ reason: 'user_exempted' });
        return;
      }

      metrics.messagesScanned.inc();

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
        // Mask every occurrence, not just the first one.
        ...[...new Set(highEntropyStrings)].flatMap(str =>
          this.findAllIndexes(text, str).map(index => ({
            match: str,
            index,
            type: 'high_entropy' as const,
            severity: 'medium' as const,
            description: 'High entropy string detected (possible secret)'
          }))
        )
      ];

      // What gets stored and audited must never contain the matched secret.
      const detectionMetadata = matches.map(({ type, severity, description, index, match }) => ({
        type,
        severity,
        description,
        index,
        length: match.length
      }));

      const { obfuscated } = this.obfuscationService.obfuscateText(
        text,
        matches.map(m => ({ match: m.match, index: m.index, type: m.type }))
      );

      const recordId = this.obfuscationService.generateId();
      const severity = this.calculateOverallSeverity(matches);
      
      await this.databaseService.storeObfuscationRecord({
        id: recordId,
        messageTs: ts,
        channelId: channel,
        userId: user,
        originalContent: this.obfuscationService.encrypt(text),
        obfuscatedContent: obfuscated,
        detectionType: detectionMetadata,
        severity,
        createdAt: new Date(),
        threadTs
      });

      // Bots can't edit other people's messages, so remove the original with
      // the admin token, then repost the masked copy as the author. Delete
      // first: if the repost fails the secret is still gone.
      try {
        await this.adminClient.chat.delete({ channel, ts });
      } catch (error) {
        await this.handleRemovalFailure(channel, user, ts, threadTs, error);
        return;
      }

      try {
        const result = await this.postAsAuthor(channel, user, threadTs, obfuscated,
          `Sent by <@${user}> · sensitive data masked by Secretly`);
        if (result?.ts) {
          await this.databaseService.setRepostTs(recordId, result.ts);
        }
      } catch (error) {
        logger.error('Failed to repost masked message:', error);
        metrics.repostFailures.inc();
      }

      const detectionSummary = this.createDetectionSummary(matches);
      
      await this.client.chat.postEphemeral({
        channel,
        user,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        text: this.createEphemeralMessage(detectionSummary, recordId),
        blocks: this.createEphemeralBlocks(detectionSummary, recordId, matches)
      });

      await this.auditService.logObfuscation({
        recordId,
        userId: user,
        channelId: channel,
        messageTs: ts,
        detections: detectionMetadata,
        action: 'obfuscated',
        timestamp: new Date()
      });

      for (const m of matches) {
        metrics.detections.inc({ type: m.type, severity: m.severity });
      }
      metrics.messagesObfuscated.inc({ severity });

      logger.info(`Obfuscated message from ${user} in ${channel} with ${matches.length} detections`);

    } catch (error) {
      logger.error('Error handling message:', error);
      metrics.messageErrors.inc();
      
      await this.auditService.logError({
        userId: (event as any).user,
        channelId: (event as any).channel,
        messageTs: (event as any).ts,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      });
    } finally {
      endTimer?.();
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
        metrics.dismissals.inc({ outcome: 'denied' });
        return;
      }

      const originalText = this.obfuscationService.decrypt(record.originalContent);

      // Post the original back as the author, then remove the masked copy.
      await this.postAsAuthor(record.channelId, record.userId, record.threadTs, originalText,
        `Sent by <@${record.userId}> · restored by <@${userId}>`);
      if (record.repostTs) {
        await this.client.chat.delete({ channel: record.channelId, ts: record.repostTs });
      }

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
      metrics.dismissals.inc({ outcome: 'dismissed' });

    } catch (error) {
      logger.error('Error handling dismissal:', error);
      metrics.dismissals.inc({ outcome: 'error' });
      throw error;
    }
  }

  private async handleRemovalFailure(
    channel: string,
    user: string,
    ts: string,
    threadTs: string | undefined,
    error: unknown
  ): Promise<void> {
    // The secret is still visible. Tell the author so they can delete it.
    logger.error('Failed to delete message containing sensitive data:', error);
    metrics.removalFailures.inc();
    await this.auditService.logError({
      userId: user,
      channelId: channel,
      messageTs: ts,
      error: `Could not remove message: ${error instanceof Error ? error.message : 'unknown error'}`,
      timestamp: new Date()
    });
    await this.client.chat.postEphemeral({
      channel,
      user,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      text: '⚠️ Your message contains sensitive data and could not be removed automatically. Please delete it now.'
    });
  }

  private async postAsAuthor(
    channel: string,
    userId: string,
    threadTs: string | undefined,
    text: string,
    attribution: string
  ): Promise<{ ts?: string } | undefined> {
    const profile = await this.getAuthorProfile(userId);
    return this.client.chat.postMessage({
      channel,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      text,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: attribution }] }
      ],
      unfurl_links: false,
      unfurl_media: false,
      // Needs the chat:write.customize scope.
      ...(profile.username ? { username: profile.username } : {}),
      ...(profile.iconUrl ? { icon_url: profile.iconUrl } : {})
    });
  }

  private async getAuthorProfile(userId: string): Promise<AuthorProfile> {
    const cached = this.profiles.get(userId);
    if (cached && cached.expires > Date.now()) {
      return cached.profile;
    }
    let profile: AuthorProfile = {};
    try {
      const info = await this.client.users.info({ user: userId });
      const p = info.user?.profile ?? {};
      profile = {
        username: p.display_name || p.real_name || info.user?.name || undefined,
        iconUrl: p.image_72 || undefined
      };
      this.profiles.set(userId, { profile, expires: Date.now() + PROFILE_TTL_MS });
    } catch (error) {
      // Fall back to the bot's own name; the attribution line still names the author.
      logger.warn('Could not look up author profile:', error);
    }
    return profile;
  }

  private findAllIndexes(text: string, value: string): number[] {
    const indexes: number[] = [];
    let index = text.indexOf(value);
    while (index !== -1) {
      indexes.push(index);
      index = text.indexOf(value, index + value.length);
    }
    return indexes;
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
      .join('\n');

    return `🔒 *Sensitive Data Detected and Obfuscated*\n\n${items}\n\nRecord ID: \`${recordId}\``;
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