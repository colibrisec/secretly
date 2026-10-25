import { AuditService } from './audit.service';
import { DatabaseService } from './database.service';
import { logger } from '../utils/logger';

jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('AuditService', () => {
  const addAuditLog = jest.fn();
  const timestamp = new Date('2026-01-01T00:00:00Z');
  let service: AuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    addAuditLog.mockResolvedValue(undefined);
    service = new AuditService({ addAuditLog } as unknown as DatabaseService);
  });

  it('logs an obfuscation with the detection count', async () => {
    const detections = [{ type: 'ssn' }, { type: 'api_key' }];
    await service.logObfuscation({
      recordId: 'R1', userId: 'U1', channelId: 'C1', messageTs: '1.2', detections, action: 'obfuscated', timestamp,
    });
    expect(addAuditLog).toHaveBeenCalledWith({
      action: 'obfuscation',
      userId: 'U1',
      channelId: 'C1',
      recordId: 'R1',
      metadata: { messageTs: '1.2', detections, detectionCount: 2 },
      timestamp,
    });
  });

  it('logs a dismissal', async () => {
    await service.logDismissal({
      recordId: 'R1', userId: 'U1', channelId: 'C1', messageTs: '1.2', dismissedBy: 'U2', timestamp,
    });
    expect(addAuditLog).toHaveBeenCalledWith({
      action: 'dismissal',
      userId: 'U1',
      channelId: 'C1',
      recordId: 'R1',
      metadata: { messageTs: '1.2', dismissedBy: 'U2' },
      timestamp,
    });
  });

  it('logs a config change without a record id', async () => {
    await service.logConfigChange({ userId: 'U1', channelId: 'C1', changes: { enabled: false }, timestamp });
    expect(addAuditLog).toHaveBeenCalledWith({
      action: 'config_change',
      userId: 'U1',
      channelId: 'C1',
      recordId: null,
      metadata: { changes: { enabled: false } },
      timestamp,
    });
  });

  it('logs an error with the provided context', async () => {
    await service.logError({ userId: 'U1', channelId: 'C1', messageTs: '1.2', error: 'boom', timestamp });
    expect(addAuditLog).toHaveBeenCalledWith({
      action: 'error',
      userId: 'U1',
      channelId: 'C1',
      recordId: null,
      metadata: { messageTs: '1.2', error: 'boom' },
      timestamp,
    });
  });

  it('logs an error without user or channel as nulls', async () => {
    await service.logError({ error: 'boom', timestamp });
    expect(addAuditLog).toHaveBeenCalledWith(expect.objectContaining({ userId: null, channelId: null }));
  });

  it('logs a permission check', async () => {
    await service.logPermissionCheck({ userId: 'U1', channelId: 'C1', action: 'dismiss', granted: false, timestamp });
    expect(addAuditLog).toHaveBeenCalledWith({
      action: 'permission_check',
      userId: 'U1',
      channelId: 'C1',
      recordId: null,
      metadata: { requestedAction: 'dismiss', granted: false },
      timestamp,
    });
  });

  describe('when the audit log cannot be written', () => {
    const calls: Array<[string, (s: AuditService) => Promise<void>]> = [
      ['obfuscation', s => s.logObfuscation({ recordId: 'R', userId: 'U', channelId: 'C', messageTs: '1', detections: [], action: 'a', timestamp })],
      ['dismissal', s => s.logDismissal({ recordId: 'R', userId: 'U', channelId: 'C', messageTs: '1', dismissedBy: 'U', timestamp })],
      ['config change', s => s.logConfigChange({ userId: 'U', channelId: 'C', changes: {}, timestamp })],
      ['error', s => s.logError({ error: 'e', timestamp })],
      ['permission check', s => s.logPermissionCheck({ userId: 'U', channelId: 'C', action: 'a', granted: true, timestamp })],
    ];

    it.each(calls)('logs the failure instead of throwing for %s', async (_name, call) => {
      addAuditLog.mockRejectedValue(new Error('database down'));
      await expect(call(service)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});
