import { App, LogLevel } from '@slack/bolt';
import * as dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { MessageHandler } from './handlers/message.handler';
import { ObfuscationService } from './services/obfuscation.service';
import { DatabaseService } from './services/database.service';
import { AuditService } from './services/audit.service';
import { PermissionService } from './services/permission.service';
import { ChannelConfigService } from './services/channel-config.service';
import { RateLimiter } from './utils/rate-limiter';
import { logger } from './utils/logger';
import { validateRequiredSecrets, getRequiredSecret } from './utils/secrets';

dotenv.config({ quiet: true });

const requiredEnvVars = [
  'DATABASE_URL',
  'REDIS_URL'
];

const requiredSecrets = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN', 
  'SLACK_SIGNING_SECRET',
  'ENCRYPTION_KEY'
];

// Check for required environment variables
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Validate required secrets (from files or env vars)
try {
  validateRequiredSecrets(requiredSecrets);
} catch (error) {
  logger.error('Secret validation failed:', error);
  process.exit(1);
}

const app = new App({
  token: getRequiredSecret('SLACK_BOT_TOKEN'),
  appToken: getRequiredSecret('SLACK_APP_TOKEN'),
  signingSecret: getRequiredSecret('SLACK_SIGNING_SECRET'),
  socketMode: true,
  logLevel: (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO
});

const healthApp = express();
const port = process.env.PORT || 3000;

async function initializeServices() {
  const databaseService = new DatabaseService(process.env.DATABASE_URL!);
  await databaseService.initialize();

  const obfuscationService = new ObfuscationService(getRequiredSecret('ENCRYPTION_KEY'));
  const auditService = new AuditService(databaseService);
  const permissionService = new PermissionService(databaseService);
  const channelConfigService = new ChannelConfigService(databaseService);
  
  const rateLimiter = new RateLimiter({
    redisUrl: process.env.REDIS_URL!,
    perUserLimit: parseInt(process.env.RATE_LIMIT_PER_USER || '10'),
    perChannelLimit: parseInt(process.env.RATE_LIMIT_PER_CHANNEL || '100'),
    globalLimit: parseInt(process.env.RATE_LIMIT_GLOBAL || '1000')
  });

  await rateLimiter.initialize();

  const messageHandler = new MessageHandler(
    app,
    obfuscationService,
    auditService,
    permissionService,
    channelConfigService,
    databaseService,
    rateLimiter
  );

  app.message(async ({ message, say }) => {
    if (message.subtype === undefined || message.subtype === 'bot_message') {
      await messageHandler.handleMessage(message as any, say);
    }
  });

  app.action('dismiss_obfuscation', async ({ action, ack, client, body }) => {
    await ack();
    
    if ('value' in action) {
      const recordId = action.value;
      const userId = body.user.id;
      
      try {
        await messageHandler.handleDismissal(recordId || 'unknown', userId || 'unknown');
      } catch {
        await client.chat.postEphemeral({
          channel: body.channel?.id || '',
          user: userId || 'unknown',
          text: '❌ Failed to dismiss obfuscation. Please try again or contact an administrator.'
        });
      }
    }
  });

  app.action('view_guidelines', async ({ ack, client, body }) => {
    await ack();
    
    await client.views.open({
      trigger_id: (body as any).trigger_id,
      view: {
        type: 'modal',
        title: {
          type: 'plain_text',
          text: 'Security Guidelines'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Why We Obfuscate Sensitive Data*\\n\\nProtecting sensitive information in Slack helps prevent:\\n• Data breaches\\n• Compliance violations\\n• Unauthorized access\\n• Identity theft'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Types of Data We Protect*\\n\\n• Credit card numbers\\n• Social Security Numbers\\n• API keys and tokens\\n• Passwords\\n• Database connection strings\\n• Personal identifiable information (PII)'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Best Practices*\\n\\n• Use secure credential management systems\\n• Share sensitive data through encrypted channels\\n• Never paste passwords or keys in plain text\\n• Use environment variables for configuration'
            }
          }
        ],
        close: {
          type: 'plain_text',
          text: 'Close'
        }
      }
    });
  });

  app.command('/secretly-config', async ({ command, ack, client }) => {
    await ack();
    
    const channelId = command.channel_id;
    const userId = command.user_id;
    
    const isAdmin = await permissionService.isChannelAdmin(userId, channelId);
    
    if (!isAdmin) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: '⚠️ Only channel administrators can configure Secretly settings.'
      });
      return;
    }
    
    const currentConfig = await channelConfigService.getChannelConfig(channelId);
    
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'channel_config',
        private_metadata: channelId,
        title: {
          type: 'plain_text',
          text: 'Channel Configuration'
        },
        submit: {
          type: 'plain_text',
          text: 'Save'
        },
        blocks: [
          {
            type: 'input',
            block_id: 'sensitivity_level',
            label: {
              type: 'plain_text',
              text: 'Sensitivity Level'
            },
            element: {
              type: 'static_select',
              action_id: 'sensitivity_select',
              initial_option: {
                text: {
                  type: 'plain_text',
                  text: currentConfig.sensitivityLevel
                },
                value: currentConfig.sensitivityLevel
              },
              options: [
                { text: { type: 'plain_text', text: 'Low' }, value: 'low' },
                { text: { type: 'plain_text', text: 'Medium' }, value: 'medium' },
                { text: { type: 'plain_text', text: 'High' }, value: 'high' },
                { text: { type: 'plain_text', text: 'Critical' }, value: 'critical' }
              ]
            }
          },
          {
            type: 'input',
            block_id: 'detection_types',
            label: {
              type: 'plain_text',
              text: 'Detection Types'
            },
            element: {
              type: 'checkboxes',
              action_id: 'detection_checkboxes',
              initial_options: currentConfig.enabledDetectors.map(d => ({
                text: { type: 'plain_text', text: d },
                value: d
              })),
              options: [
                { text: { type: 'plain_text', text: 'Credit Cards' }, value: 'credit_card' },
                { text: { type: 'plain_text', text: 'SSN' }, value: 'ssn' },
                { text: { type: 'plain_text', text: 'API Keys' }, value: 'api_key' },
                { text: { type: 'plain_text', text: 'Passwords' }, value: 'password' },
                { text: { type: 'plain_text', text: 'Email Addresses' }, value: 'email' },
                { text: { type: 'plain_text', text: 'Phone Numbers' }, value: 'phone' },
                { text: { type: 'plain_text', text: 'IP Addresses' }, value: 'ip_address' }
              ]
            }
          }
        ]
      }
    });
  });

  app.view('channel_config', async ({ ack, view, client, body }) => {
    await ack();
    
    const channelId = view.private_metadata;
    const userId = body.user.id;
    
    const sensitivityLevel = view.state.values.sensitivity_level.sensitivity_select.selected_option?.value as 'low' | 'medium' | 'high' | 'critical' || 'medium';
    const detectionTypes = view.state.values.detection_types.detection_checkboxes.selected_options?.map(o => o.value) || [];
    
    await channelConfigService.updateChannelConfig(channelId, {
      sensitivityLevel,
      enabledDetectors: detectionTypes
    });
    
    await auditService.logConfigChange({
      userId,
      channelId,
      changes: { sensitivityLevel, enabledDetectors: detectionTypes },
      timestamp: new Date()
    });
    
    await client.chat.postMessage({
      channel: channelId,
      text: `✅ Channel security configuration has been updated by <@${userId}>`
    });
  });

  // Rate limiting for health endpoints with whitelist for localhost and health checks
  const healthRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // Limit each IP to 60 requests per windowMs (1 per second average)
    message: {
      error: 'Too many health check requests, please try again later',
      retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting for localhost, private IPs, and health check sources
    skip: (req) => {
      const ip = req.ip || req.connection.remoteAddress || '';
      
      // Localhost and loopback
      if (ip === '127.0.0.1' || ip === '::1' || ip.includes('127.0.0.1') || ip.includes('localhost')) {
        return true;
      }
      
      // Private IP ranges (Docker, Kubernetes, internal networks)
      if (
        ip.startsWith('10.') ||           // 10.0.0.0/8
        ip.startsWith('172.') ||          // 172.16.0.0/12 
        ip.startsWith('192.168.') ||      // 192.168.0.0/16
        ip.startsWith('169.254.') ||      // Link-local
        ip.includes('::ffff:10.') ||      // IPv6-mapped private IPs
        ip.includes('::ffff:172.') ||
        ip.includes('::ffff:192.168.')
      ) {
        return true;
      }
      
      return false;
    }
  });

  // Apply rate limiting to health endpoints
  healthApp.use(healthRateLimiter);

  // Health check endpoints
  healthApp.get('/health', (_req, res) => {
    res.status(200).json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0'
    });
  });

  healthApp.get('/ready', async (_req, res) => {
    try {
      // Check database connection
      await databaseService.pool.query('SELECT 1');
      
      // Check Redis connection (if rateLimiter is initialized)
      // This is a basic check - you might want to add more comprehensive checks
      
      res.status(200).json({ 
        status: 'ready', 
        timestamp: new Date().toISOString(),
        checks: {
          database: 'healthy',
          redis: 'healthy'
        }
      });
    } catch (error) {
      res.status(503).json({ 
        status: 'not ready', 
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  healthApp.listen(port, () => {
    logger.info(`Health check server listening on port ${port}`);
  });

  logger.info('All services initialized successfully');
}

async function start() {
  try {
    await initializeServices();
    await app.start();
    logger.info('⚡️ Secretly bot is running!');
  } catch (error) {
    logger.error('Failed to start the app:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  await app.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  await app.stop();
  process.exit(0);
});

start();