import { createClient } from 'redis';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { RateLimiter } from './rate-limiter';
import { logger } from './logger';

jest.mock('redis', () => ({ createClient: jest.fn() }));
jest.mock('rate-limiter-flexible', () => ({ RateLimiterRedis: jest.fn() }));
jest.mock('./logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

interface FakeLimiter {
  consume: jest.Mock;
  get: jest.Mock;
  delete: jest.Mock;
}

describe('RateLimiter', () => {
  const config = { redisUrl: 'redis://localhost:6379', perUserLimit: 5, perChannelLimit: 20, globalLimit: 100 };
  const redisClient = { on: jest.fn(), connect: jest.fn(), quit: jest.fn() };
  let limiters: Record<string, FakeLimiter>;
  let limiter: RateLimiter;

  beforeEach(() => {
    jest.resetAllMocks();
    limiters = {};
    redisClient.connect.mockResolvedValue(undefined);
    redisClient.quit.mockResolvedValue(undefined);
    (createClient as jest.Mock).mockReturnValue(redisClient);
    (RateLimiterRedis as unknown as jest.Mock).mockImplementation((options: { keyPrefix: string }) => {
      const fake: FakeLimiter = {
        consume: jest.fn().mockResolvedValue({}),
        get: jest.fn().mockResolvedValue(null),
        delete: jest.fn().mockResolvedValue(true),
      };
      limiters[options.keyPrefix] = fake;
      return fake;
    });
    limiter = new RateLimiter(config);
  });

  describe('initialize', () => {
    it('connects to redis and creates a limiter per scope', async () => {
      await limiter.initialize();
      expect(createClient).toHaveBeenCalledWith({ url: config.redisUrl });
      expect(redisClient.connect).toHaveBeenCalled();
      expect(RateLimiterRedis).toHaveBeenCalledWith(expect.objectContaining({ keyPrefix: 'rl:user', points: 5 }));
      expect(RateLimiterRedis).toHaveBeenCalledWith(expect.objectContaining({ keyPrefix: 'rl:channel', points: 20 }));
      expect(RateLimiterRedis).toHaveBeenCalledWith(expect.objectContaining({ keyPrefix: 'rl:global', points: 100 }));
    });

    it('logs redis client errors', async () => {
      await limiter.initialize();
      const onError = redisClient.on.mock.calls.find(([event]) => event === 'error')![1];
      const error = new Error('connection reset');
      onError(error);
      expect(logger.error).toHaveBeenCalledWith('Redis client error:', error);
    });

    it('rethrows when redis cannot be reached', async () => {
      redisClient.connect.mockRejectedValue(new Error('refused'));
      await expect(limiter.initialize()).rejects.toThrow('refused');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('checkLimit', () => {
    it('allows requests when the limiters are not initialized', async () => {
      await expect(limiter.checkLimit('U1', 'C1')).resolves.toEqual({ allowed: true });
      expect(logger.warn).toHaveBeenCalled();
    });

    describe('once initialized', () => {
      beforeEach(async () => {
        await limiter.initialize();
      });

      it('allows a request within every limit', async () => {
        await expect(limiter.checkLimit('U1', 'C1')).resolves.toEqual({ allowed: true });
        expect(limiters['rl:global'].consume).toHaveBeenCalledWith('global', 1);
        expect(limiters['rl:user'].consume).toHaveBeenCalledWith('U1', 1);
        expect(limiters['rl:channel'].consume).toHaveBeenCalledWith('C1', 1);
      });

      it('rejects when the global limit is exceeded and does not check the others', async () => {
        limiters['rl:global'].consume.mockRejectedValue({ msBeforeNext: 2400 });
        const result = await limiter.checkLimit('U1', 'C1');
        expect(result).toEqual({ allowed: false, reason: 'Global rate limit exceeded. Retry in 2 seconds' });
        expect(limiters['rl:user'].consume).not.toHaveBeenCalled();
      });

      it('rejects when the user limit is exceeded', async () => {
        limiters['rl:user'].consume.mockRejectedValue({ msBeforeNext: 1000 });
        const result = await limiter.checkLimit('U1', 'C1');
        expect(result).toEqual({ allowed: false, reason: 'User rate limit exceeded. Retry in 1 seconds' });
        expect(limiters['rl:channel'].consume).not.toHaveBeenCalled();
      });

      it('rejects when the channel limit is exceeded', async () => {
        limiters['rl:channel'].consume.mockRejectedValue({ msBeforeNext: 3000 });
        const result = await limiter.checkLimit('U1', 'C1');
        expect(result).toEqual({ allowed: false, reason: 'Channel rate limit exceeded. Retry in 3 seconds' });
      });

      it('allows the request when the limiter fails unexpectedly', async () => {
        limiters['rl:global'].consume.mockRejectedValue(undefined);
        await expect(limiter.checkLimit('U1', 'C1')).resolves.toEqual({ allowed: true });
        expect(logger.error).toHaveBeenCalled();
      });
    });
  });

  describe('reset', () => {
    beforeEach(async () => {
      await limiter.initialize();
    });

    it.each([
      ['user', 'rl:user'],
      ['channel', 'rl:channel'],
      ['global', 'rl:global'],
    ] as const)('clears the %s limiter for a key', async (type, prefix) => {
      await limiter.reset('key1', type);
      expect(limiters[prefix].delete).toHaveBeenCalledWith('key1');
    });

    it('does nothing for an unknown scope', async () => {
      await limiter.reset('key1', 'other' as 'user');
      Object.values(limiters).forEach(l => expect(l.delete).not.toHaveBeenCalled());
    });

    it('does nothing before initialization', async () => {
      await expect(new RateLimiter(config).reset('key1', 'user')).resolves.toBeUndefined();
    });

    it('logs instead of throwing when clearing fails', async () => {
      limiters['rl:user'].delete.mockRejectedValue(new Error('redis down'));
      await expect(limiter.reset('key1', 'user')).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('is empty before initialization', async () => {
      await expect(limiter.getStatus('U1', 'C1')).resolves.toEqual({});
    });

    describe('once initialized', () => {
      beforeEach(async () => {
        await limiter.initialize();
      });

      it('reports the full allowance when nothing was consumed', async () => {
        await expect(limiter.getStatus('U1', 'C1')).resolves.toEqual({
          global: { consumed: 0, remaining: 100 },
          user: { consumed: 0, remaining: 5 },
          channel: { consumed: 0, remaining: 20 },
        });
      });

      it('reports consumed and remaining points', async () => {
        limiters['rl:global'].get.mockResolvedValue({ consumedPoints: 10, remainingPoints: 90 });
        limiters['rl:user'].get.mockResolvedValue({ consumedPoints: 2, remainingPoints: 3 });
        limiters['rl:channel'].get.mockResolvedValue({ consumedPoints: 7, remainingPoints: 13 });
        await expect(limiter.getStatus('U1', 'C1')).resolves.toEqual({
          global: { consumed: 10, remaining: 90 },
          user: { consumed: 2, remaining: 3 },
          channel: { consumed: 7, remaining: 13 },
        });
      });

      it('only reports the global scope without a user or channel', async () => {
        await expect(limiter.getStatus()).resolves.toEqual({ global: { consumed: 0, remaining: 100 } });
      });

      it('returns what it has when a lookup fails', async () => {
        limiters['rl:user'].get.mockRejectedValue(new Error('redis down'));
        await expect(limiter.getStatus('U1', 'C1')).resolves.toEqual({ global: { consumed: 0, remaining: 100 } });
        expect(logger.error).toHaveBeenCalled();
      });
    });
  });

  describe('close', () => {
    it('quits the redis client', async () => {
      await limiter.initialize();
      await limiter.close();
      expect(redisClient.quit).toHaveBeenCalled();
    });

    it('does nothing before initialization', async () => {
      await expect(limiter.close()).resolves.toBeUndefined();
      expect(redisClient.quit).not.toHaveBeenCalled();
    });
  });
});
