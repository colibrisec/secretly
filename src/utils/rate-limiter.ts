import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import Redis from 'redis';
import { logger } from './logger';

export interface RateLimiterConfig {
  redisUrl: string;
  perUserLimit: number;
  perChannelLimit: number;
  globalLimit: number;
}

export class RateLimiter {
  private userLimiter?: RateLimiterRedis;
  private channelLimiter?: RateLimiterRedis;
  private globalLimiter?: RateLimiterRedis;
  private redisClient?: any;

  constructor(private config: RateLimiterConfig) {}

  async initialize(): Promise<void> {
    try {
      this.redisClient = Redis.createClient({
        url: this.config.redisUrl
      });

      await this.redisClient.connect();

      this.userLimiter = new RateLimiterRedis({
        storeClient: this.redisClient,
        keyPrefix: 'rl:user',
        points: this.config.perUserLimit,
        duration: 1,
        blockDuration: 1
      });

      this.channelLimiter = new RateLimiterRedis({
        storeClient: this.redisClient,
        keyPrefix: 'rl:channel',
        points: this.config.perChannelLimit,
        duration: 1,
        blockDuration: 1
      });

      this.globalLimiter = new RateLimiterRedis({
        storeClient: this.redisClient,
        keyPrefix: 'rl:global',
        points: this.config.globalLimit,
        duration: 1,
        blockDuration: 1
      });

      logger.info('Rate limiter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize rate limiter:', error);
      throw error;
    }
  }

  async checkLimit(userId: string, channelId: string): Promise<{ allowed: boolean; reason?: string }> {
    try {
      if (!this.userLimiter || !this.channelLimiter || !this.globalLimiter) {
        logger.warn('Rate limiters not initialized, allowing request');
        return { allowed: true };
      }

      try {
        await this.globalLimiter.consume('global', 1);
      } catch (rejRes) {
        return { 
          allowed: false, 
          reason: `Global rate limit exceeded. Retry in ${Math.round((rejRes as RateLimiterRes).msBeforeNext / 1000)} seconds`
        };
      }

      try {
        await this.userLimiter.consume(userId, 1);
      } catch (rejRes) {
        return { 
          allowed: false, 
          reason: `User rate limit exceeded. Retry in ${Math.round((rejRes as RateLimiterRes).msBeforeNext / 1000)} seconds`
        };
      }

      try {
        await this.channelLimiter.consume(channelId, 1);
      } catch (rejRes) {
        return { 
          allowed: false, 
          reason: `Channel rate limit exceeded. Retry in ${Math.round((rejRes as RateLimiterRes).msBeforeNext / 1000)} seconds`
        };
      }

      return { allowed: true };
    } catch (error) {
      logger.error('Error checking rate limit:', error);
      return { allowed: true };
    }
  }

  async reset(key: string, type: 'user' | 'channel' | 'global'): Promise<void> {
    try {
      let limiter: RateLimiterRedis | undefined;
      
      switch (type) {
        case 'user':
          limiter = this.userLimiter;
          break;
        case 'channel':
          limiter = this.channelLimiter;
          break;
        case 'global':
          limiter = this.globalLimiter;
          break;
      }

      if (limiter) {
        await limiter.delete(key);
      }
    } catch (error) {
      logger.error('Error resetting rate limit:', error);
    }
  }

  async getStatus(userId?: string, channelId?: string): Promise<any> {
    const status: any = {};

    try {
      if (this.globalLimiter) {
        const globalRes = await this.globalLimiter.get('global');
        status.global = {
          consumed: globalRes ? globalRes.consumedPoints : 0,
          remaining: globalRes ? globalRes.remainingPoints : this.config.globalLimit
        };
      }

      if (userId && this.userLimiter) {
        const userRes = await this.userLimiter.get(userId);
        status.user = {
          consumed: userRes ? userRes.consumedPoints : 0,
          remaining: userRes ? userRes.remainingPoints : this.config.perUserLimit
        };
      }

      if (channelId && this.channelLimiter) {
        const channelRes = await this.channelLimiter.get(channelId);
        status.channel = {
          consumed: channelRes ? channelRes.consumedPoints : 0,
          remaining: channelRes ? channelRes.remainingPoints : this.config.perChannelLimit
        };
      }
    } catch (error) {
      logger.error('Error getting rate limit status:', error);
    }

    return status;
  }

  async close(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.quit();
    }
  }
}