import { ChannelConfigService } from './channel-config.service';
import { DatabaseService } from './database.service';
import { logger } from '../utils/logger';

jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const MEDIUM_DETECTORS = ['credit_card', 'ssn', 'api_key', 'password'];

describe('ChannelConfigService', () => {
  const getChannelConfig = jest.fn();
  const createChannelConfig = jest.fn();
  const query = jest.fn();
  const databaseService = { getChannelConfig, createChannelConfig, pool: { query } } as unknown as DatabaseService;
  let service: ChannelConfigService;

  const storedRow = (overrides: Record<string, unknown> = {}) => ({
    channel_id: 'C1',
    enabled: true,
    sensitivity_level: 'medium',
    enabled_detectors: ['ssn'],
    detect_high_entropy: true,
    entropy_threshold: 4.5,
    exempted_users: ['U1'],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    createChannelConfig.mockResolvedValue(undefined);
    service = new ChannelConfigService(databaseService);
  });

  describe('getChannelConfig', () => {
    it('maps a stored row to the channel config', async () => {
      getChannelConfig.mockResolvedValue(storedRow({
        enabled: false, sensitivity_level: 'high', detect_high_entropy: false, entropy_threshold: 3,
      }));
      await expect(service.getChannelConfig('C1')).resolves.toEqual({
        channelId: 'C1',
        enabled: false,
        sensitivityLevel: 'high',
        enabledDetectors: ['ssn'],
        detectHighEntropy: false,
        entropyThreshold: 3,
        exemptedUsers: ['U1'],
      });
    });

    it('fills in defaults for missing columns', async () => {
      getChannelConfig.mockResolvedValue({});
      await expect(service.getChannelConfig('C9')).resolves.toEqual({
        channelId: 'C9',
        enabled: true,
        sensitivityLevel: 'medium',
        enabledDetectors: MEDIUM_DETECTORS,
        detectHighEntropy: true,
        entropyThreshold: 4.5,
        exemptedUsers: [],
      });
    });

    it('falls back to the default config when the lookup fails', async () => {
      getChannelConfig.mockRejectedValue(new Error('database down'));
      await expect(service.getChannelConfig('C1')).resolves.toEqual({
        channelId: 'C1',
        enabled: true,
        sensitivityLevel: 'medium',
        enabledDetectors: MEDIUM_DETECTORS,
        detectHighEntropy: true,
        entropyThreshold: 4.5,
        exemptedUsers: [],
      });
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('updateChannelConfig', () => {
    it('merges the updates into the current config and stores it', async () => {
      getChannelConfig.mockResolvedValue(storedRow());
      await service.updateChannelConfig('C1', { entropyThreshold: 5 });
      expect(createChannelConfig).toHaveBeenCalledWith({
        channelId: 'C1',
        enabled: true,
        sensitivityLevel: 'medium',
        enabledDetectors: ['ssn'],
        detectHighEntropy: true,
        entropyThreshold: 5,
        exemptedUsers: ['U1'],
      });
    });

    it('never lets the updates change the channel id', async () => {
      getChannelConfig.mockResolvedValue(storedRow());
      await service.updateChannelConfig('C1', { channelId: 'C2' });
      expect(createChannelConfig).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'C1' }));
    });

    it('rethrows when the config cannot be stored', async () => {
      getChannelConfig.mockResolvedValue(storedRow());
      createChannelConfig.mockRejectedValue(new Error('write failed'));
      await expect(service.updateChannelConfig('C1', { enabled: false })).rejects.toThrow('write failed');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('enabling and disabling a channel', () => {
    it('enables the channel', async () => {
      getChannelConfig.mockResolvedValue(storedRow({ enabled: false }));
      await service.enableChannel('C1');
      expect(createChannelConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    });

    it('disables the channel', async () => {
      getChannelConfig.mockResolvedValue(storedRow());
      await service.disableChannel('C1');
      expect(createChannelConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });
  });

  describe('setSensitivityLevel', () => {
    it.each([
      ['low', ['credit_card', 'ssn', 'api_key']],
      ['medium', MEDIUM_DETECTORS],
      ['high', [...MEDIUM_DETECTORS, 'email', 'phone']],
      ['critical', [...MEDIUM_DETECTORS, 'email', 'phone', 'ip_address']],
    ])('enables the %s detector set', async (level, detectors) => {
      getChannelConfig.mockResolvedValue(storedRow());
      await service.setSensitivityLevel('C1', level as 'low' | 'medium' | 'high' | 'critical');
      expect(createChannelConfig).toHaveBeenCalledWith(
        expect.objectContaining({ sensitivityLevel: level, enabledDetectors: detectors })
      );
    });

    it('uses the medium detector set for an unknown level', async () => {
      getChannelConfig.mockResolvedValue(storedRow());
      await service.setSensitivityLevel('C1', 'bogus' as 'low');
      expect(createChannelConfig).toHaveBeenCalledWith(expect.objectContaining({ enabledDetectors: MEDIUM_DETECTORS }));
    });
  });

  describe('exempted users', () => {
    it('adds a user', async () => {
      getChannelConfig.mockResolvedValue(storedRow());
      await service.addExemptedUser('C1', 'U2');
      expect(createChannelConfig).toHaveBeenCalledWith(expect.objectContaining({ exemptedUsers: ['U1', 'U2'] }));
    });

    it('does not store anything when the user is already exempted', async () => {
      getChannelConfig.mockResolvedValue(storedRow());
      await service.addExemptedUser('C1', 'U1');
      expect(createChannelConfig).not.toHaveBeenCalled();
    });

    it('removes a user', async () => {
      getChannelConfig.mockResolvedValue(storedRow({ exempted_users: ['U1', 'U2'] }));
      await service.removeExemptedUser('C1', 'U1');
      expect(createChannelConfig).toHaveBeenCalledWith(expect.objectContaining({ exemptedUsers: ['U2'] }));
    });
  });

  describe('detectors', () => {
    it('enables a detector', async () => {
      getChannelConfig.mockResolvedValue(storedRow());
      await service.enableDetector('C1', 'email');
      expect(createChannelConfig).toHaveBeenCalledWith(expect.objectContaining({ enabledDetectors: ['ssn', 'email'] }));
    });

    it('does not store anything when the detector is already enabled', async () => {
      getChannelConfig.mockResolvedValue(storedRow());
      await service.enableDetector('C1', 'ssn');
      expect(createChannelConfig).not.toHaveBeenCalled();
    });

    it('disables a detector', async () => {
      getChannelConfig.mockResolvedValue(storedRow({ enabled_detectors: ['ssn', 'email'] }));
      await service.disableDetector('C1', 'ssn');
      expect(createChannelConfig).toHaveBeenCalledWith(expect.objectContaining({ enabledDetectors: ['email'] }));
    });
  });

  describe('getActiveChannels', () => {
    it('returns the ids of enabled channels', async () => {
      query.mockResolvedValue({ rows: [{ channel_id: 'C1' }, { channel_id: 'C2' }] });
      await expect(service.getActiveChannels()).resolves.toEqual(['C1', 'C2']);
    });

    it('returns no channels when the query fails', async () => {
      query.mockRejectedValue(new Error('database down'));
      await expect(service.getActiveChannels()).resolves.toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getChannelStats', () => {
    it('returns the aggregated row for the channel', async () => {
      const stats = { total_obfuscations: '3', unique_users: '2', dismissed_count: '1', avg_dismissal_time_seconds: null };
      query.mockResolvedValue({ rows: [stats] });
      await expect(service.getChannelStats('C1')).resolves.toEqual(stats);
      expect(query).toHaveBeenCalledWith(expect.any(String), ['C1']);
    });

    it('returns null when the query fails', async () => {
      query.mockRejectedValue(new Error('database down'));
      await expect(service.getChannelStats('C1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
