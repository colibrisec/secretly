import { DatabaseService } from './database.service';
import { logger } from '../utils/logger';

export class AuditService {
  constructor(private databaseService: DatabaseService) {}

  async logObfuscation(data: {
    recordId: string;
    userId: string;
    channelId: string;
    messageTs: string;
    detections: any[];
    action: string;
    timestamp: Date;
  }): Promise<void> {
    try {
      await this.databaseService.addAuditLog({
        action: 'obfuscation',
        userId: data.userId,
        channelId: data.channelId,
        recordId: data.recordId,
        metadata: {
          messageTs: data.messageTs,
          detections: data.detections,
          detectionCount: data.detections.length
        },
        timestamp: data.timestamp
      });
    } catch (error) {
      logger.error('Failed to log obfuscation:', error);
    }
  }

  async logDismissal(data: {
    recordId: string;
    userId: string;
    channelId: string;
    messageTs: string;
    dismissedBy: string;
    timestamp: Date;
  }): Promise<void> {
    try {
      await this.databaseService.addAuditLog({
        action: 'dismissal',
        userId: data.userId,
        channelId: data.channelId,
        recordId: data.recordId,
        metadata: {
          messageTs: data.messageTs,
          dismissedBy: data.dismissedBy
        },
        timestamp: data.timestamp
      });
    } catch (error) {
      logger.error('Failed to log dismissal:', error);
    }
  }

  async logConfigChange(data: {
    userId: string;
    channelId: string;
    changes: any;
    timestamp: Date;
  }): Promise<void> {
    try {
      await this.databaseService.addAuditLog({
        action: 'config_change',
        userId: data.userId,
        channelId: data.channelId,
        recordId: null,
        metadata: {
          changes: data.changes
        },
        timestamp: data.timestamp
      });
    } catch (error) {
      logger.error('Failed to log config change:', error);
    }
  }

  async logError(data: {
    userId?: string;
    channelId?: string;
    messageTs?: string;
    error: string;
    timestamp: Date;
  }): Promise<void> {
    try {
      await this.databaseService.addAuditLog({
        action: 'error',
        userId: data.userId || null,
        channelId: data.channelId || null,
        recordId: null,
        metadata: {
          messageTs: data.messageTs,
          error: data.error
        },
        timestamp: data.timestamp
      });
    } catch (error) {
      logger.error('Failed to log error:', error);
    }
  }

  async logPermissionCheck(data: {
    userId: string;
    channelId: string;
    action: string;
    granted: boolean;
    timestamp: Date;
  }): Promise<void> {
    try {
      await this.databaseService.addAuditLog({
        action: 'permission_check',
        userId: data.userId,
        channelId: data.channelId,
        recordId: null,
        metadata: {
          requestedAction: data.action,
          granted: data.granted
        },
        timestamp: data.timestamp
      });
    } catch (error) {
      logger.error('Failed to log permission check:', error);
    }
  }
}