import { DatabaseService } from './database.service';
import { logger } from '../utils/logger';

export interface ChannelConfig {
  channelId: string;
  enabled: boolean;
  sensitivityLevel: 'low' | 'medium' | 'high' | 'critical';
  enabledDetectors: string[];
  detectHighEntropy: boolean;
  entropyThreshold: number;
  exemptedUsers: string[];
}

export class ChannelConfigService {
  constructor(private databaseService: DatabaseService) {}

  async getChannelConfig(channelId: string): Promise<ChannelConfig> {
    try {
      const config = await this.databaseService.getChannelConfig(channelId);
      
      return {
        channelId: config.channel_id || channelId,
        enabled: config.enabled ?? true,
        sensitivityLevel: config.sensitivity_level || 'medium',
        enabledDetectors: config.enabled_detectors || this.getDefaultDetectors('medium'),
        detectHighEntropy: config.detect_high_entropy ?? true,
        entropyThreshold: config.entropy_threshold || 4.5,
        exemptedUsers: config.exempted_users || []
      };
    } catch (error) {
      logger.error('Error getting channel config:', error);
      return this.getDefaultConfig(channelId);
    }
  }

  async updateChannelConfig(channelId: string, updates: Partial<ChannelConfig>): Promise<void> {
    try {
      const currentConfig = await this.getChannelConfig(channelId);
      
      const updatedConfig = {
        ...currentConfig,
        ...updates,
        channelId
      };

      await this.databaseService.createChannelConfig(updatedConfig);
      
      logger.info(`Channel config updated for ${channelId}`);
    } catch (error) {
      logger.error('Error updating channel config:', error);
      throw error;
    }
  }

  async enableChannel(channelId: string): Promise<void> {
    await this.updateChannelConfig(channelId, { enabled: true });
  }

  async disableChannel(channelId: string): Promise<void> {
    await this.updateChannelConfig(channelId, { enabled: false });
  }

  async setSensitivityLevel(channelId: string, level: 'low' | 'medium' | 'high' | 'critical'): Promise<void> {
    const enabledDetectors = this.getDefaultDetectors(level);
    await this.updateChannelConfig(channelId, { 
      sensitivityLevel: level,
      enabledDetectors
    });
  }

  async addExemptedUser(channelId: string, userId: string): Promise<void> {
    const config = await this.getChannelConfig(channelId);
    if (!config.exemptedUsers.includes(userId)) {
      config.exemptedUsers.push(userId);
      await this.updateChannelConfig(channelId, { exemptedUsers: config.exemptedUsers });
    }
  }

  async removeExemptedUser(channelId: string, userId: string): Promise<void> {
    const config = await this.getChannelConfig(channelId);
    config.exemptedUsers = config.exemptedUsers.filter(u => u !== userId);
    await this.updateChannelConfig(channelId, { exemptedUsers: config.exemptedUsers });
  }

  async enableDetector(channelId: string, detectorType: string): Promise<void> {
    const config = await this.getChannelConfig(channelId);
    if (!config.enabledDetectors.includes(detectorType)) {
      config.enabledDetectors.push(detectorType);
      await this.updateChannelConfig(channelId, { enabledDetectors: config.enabledDetectors });
    }
  }

  async disableDetector(channelId: string, detectorType: string): Promise<void> {
    const config = await this.getChannelConfig(channelId);
    config.enabledDetectors = config.enabledDetectors.filter(d => d !== detectorType);
    await this.updateChannelConfig(channelId, { enabledDetectors: config.enabledDetectors });
  }

  private getDefaultConfig(channelId: string): ChannelConfig {
    return {
      channelId,
      enabled: true,
      sensitivityLevel: 'medium',
      enabledDetectors: this.getDefaultDetectors('medium'),
      detectHighEntropy: true,
      entropyThreshold: 4.5,
      exemptedUsers: []
    };
  }

  private getDefaultDetectors(sensitivityLevel: string): string[] {
    switch (sensitivityLevel) {
    case 'low':
      return ['credit_card', 'ssn', 'api_key'];
    case 'medium':
      return ['credit_card', 'ssn', 'api_key', 'password'];
    case 'high':
      return ['credit_card', 'ssn', 'api_key', 'password', 'email', 'phone'];
    case 'critical':
      return ['credit_card', 'ssn', 'api_key', 'password', 'email', 'phone', 'ip_address'];
    default:
      return ['credit_card', 'ssn', 'api_key', 'password'];
    }
  }

  async getActiveChannels(): Promise<string[]> {
    try {
      const query = 'SELECT channel_id FROM channel_configs WHERE enabled = true';
      const result = await (this.databaseService as any).pool.query(query);
      return result.rows.map((row: any) => row.channel_id);
    } catch (error) {
      logger.error('Error getting active channels:', error);
      return [];
    }
  }

  async getChannelStats(channelId: string): Promise<any> {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_obfuscations,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(CASE WHEN dismissed_at IS NOT NULL THEN 1 END) as dismissed_count,
          AVG(EXTRACT(EPOCH FROM (dismissed_at - created_at))) as avg_dismissal_time_seconds
        FROM obfuscation_records
        WHERE channel_id = $1
      `;
      
      const result = await (this.databaseService as any).pool.query(query, [channelId]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error getting channel stats:', error);
      return null;
    }
  }
}