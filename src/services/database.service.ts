import { Pool } from 'pg';
import { logger } from '../utils/logger';

export class DatabaseService {
  public pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.createTables();
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    const queries = [
      `CREATE TABLE IF NOT EXISTS obfuscation_records (
        id VARCHAR(32) PRIMARY KEY,
        message_ts VARCHAR(20) NOT NULL,
        channel_id VARCHAR(20) NOT NULL,
        user_id VARCHAR(20) NOT NULL,
        original_content TEXT NOT NULL,
        obfuscated_content TEXT NOT NULL,
        detection_type JSONB NOT NULL,
        severity VARCHAR(10) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        dismissed_at TIMESTAMP,
        dismissed_by VARCHAR(20),
        INDEX idx_message (channel_id, message_ts),
        INDEX idx_user (user_id),
        INDEX idx_created (created_at)
      )`,
      
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        action VARCHAR(50) NOT NULL,
        user_id VARCHAR(20),
        channel_id VARCHAR(20),
        record_id VARCHAR(32),
        metadata JSONB,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
        INDEX idx_action (action),
        INDEX idx_timestamp (timestamp)
      )`,
      
      `CREATE TABLE IF NOT EXISTS channel_configs (
        channel_id VARCHAR(20) PRIMARY KEY,
        enabled BOOLEAN DEFAULT true,
        sensitivity_level VARCHAR(10) DEFAULT 'medium',
        enabled_detectors TEXT[],
        detect_high_entropy BOOLEAN DEFAULT true,
        entropy_threshold FLOAT DEFAULT 4.5,
        exempted_users TEXT[],
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`,
      
      `CREATE TABLE IF NOT EXISTS user_permissions (
        user_id VARCHAR(20) NOT NULL,
        channel_id VARCHAR(20) NOT NULL,
        can_dismiss_low BOOLEAN DEFAULT false,
        can_dismiss_medium BOOLEAN DEFAULT false,
        can_dismiss_high BOOLEAN DEFAULT false,
        can_dismiss_critical BOOLEAN DEFAULT false,
        is_admin BOOLEAN DEFAULT false,
        PRIMARY KEY (user_id, channel_id)
      )`
    ];

    for (const query of queries) {
      try {
        await this.pool.query(query.replace(/INDEX/g, 'CREATE INDEX IF NOT EXISTS'));
      } catch (error) {
        logger.error(`Failed to create table: ${error}`);
      }
    }
  }

  async storeObfuscationRecord(record: any): Promise<void> {
    const query = `
      INSERT INTO obfuscation_records 
      (id, message_ts, channel_id, user_id, original_content, obfuscated_content, detection_type, severity, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    
    await this.pool.query(query, [
      record.id,
      record.messageTs,
      record.channelId,
      record.userId,
      record.originalContent,
      record.obfuscatedContent,
      JSON.stringify(record.detectionType),
      record.severity,
      record.createdAt
    ]);
  }

  async getObfuscationRecord(id: string): Promise<any> {
    const query = 'SELECT * FROM obfuscation_records WHERE id = $1';
    const result = await this.pool.query(query, [id]);
    return result.rows[0];
  }

  async markObfuscationDismissed(id: string, userId: string): Promise<void> {
    const query = `
      UPDATE obfuscation_records 
      SET dismissed_at = NOW(), dismissed_by = $2 
      WHERE id = $1
    `;
    await this.pool.query(query, [id, userId]);
  }

  async getChannelConfig(channelId: string): Promise<any> {
    const query = 'SELECT * FROM channel_configs WHERE channel_id = $1';
    const result = await this.pool.query(query, [channelId]);
    
    if (result.rows.length === 0) {
      const defaultConfig = {
        channelId,
        enabled: true,
        sensitivityLevel: 'medium',
        enabledDetectors: ['credit_card', 'ssn', 'api_key', 'password'],
        detectHighEntropy: true,
        entropyThreshold: 4.5,
        exemptedUsers: []
      };
      
      await this.createChannelConfig(defaultConfig);
      return defaultConfig;
    }
    
    return result.rows[0];
  }

  async createChannelConfig(config: any): Promise<void> {
    const query = `
      INSERT INTO channel_configs 
      (channel_id, enabled, sensitivity_level, enabled_detectors, detect_high_entropy, entropy_threshold, exempted_users)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (channel_id) DO UPDATE
      SET enabled = $2, sensitivity_level = $3, enabled_detectors = $4, 
          detect_high_entropy = $5, entropy_threshold = $6, exempted_users = $7, updated_at = NOW()
    `;
    
    await this.pool.query(query, [
      config.channelId,
      config.enabled,
      config.sensitivityLevel,
      config.enabledDetectors,
      config.detectHighEntropy,
      config.entropyThreshold,
      config.exemptedUsers
    ]);
  }

  async getUserPermissions(userId: string, channelId: string): Promise<any> {
    const query = 'SELECT * FROM user_permissions WHERE user_id = $1 AND channel_id = $2';
    const result = await this.pool.query(query, [userId, channelId]);
    
    if (result.rows.length === 0) {
      return {
        canDismissLow: false,
        canDismissMedium: false,
        canDismissHigh: false,
        canDismissCritical: false,
        isAdmin: false
      };
    }
    
    return result.rows[0];
  }

  async setUserPermissions(userId: string, channelId: string, permissions: any): Promise<void> {
    const query = `
      INSERT INTO user_permissions 
      (user_id, channel_id, can_dismiss_low, can_dismiss_medium, can_dismiss_high, can_dismiss_critical, is_admin)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, channel_id) DO UPDATE
      SET can_dismiss_low = $3, can_dismiss_medium = $4, can_dismiss_high = $5, 
          can_dismiss_critical = $6, is_admin = $7
    `;
    
    await this.pool.query(query, [
      userId,
      channelId,
      permissions.canDismissLow,
      permissions.canDismissMedium,
      permissions.canDismissHigh,
      permissions.canDismissCritical,
      permissions.isAdmin
    ]);
  }

  async addAuditLog(log: any): Promise<void> {
    const query = `
      INSERT INTO audit_logs (action, user_id, channel_id, record_id, metadata, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    
    await this.pool.query(query, [
      log.action,
      log.userId,
      log.channelId,
      log.recordId,
      JSON.stringify(log.metadata),
      log.timestamp
    ]);
  }

  async cleanupOldRecords(daysToKeep: number): Promise<void> {
    const query = `
      DELETE FROM obfuscation_records 
      WHERE created_at < NOW() - INTERVAL '${daysToKeep} days'
    `;
    await this.pool.query(query);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}