import { Pool } from 'pg';
import { DatabaseService } from './database.service';
import { buildDatabaseSsl, stripSslParameters } from '../utils/database-ssl';
import { logger } from '../utils/logger';

jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('../utils/database-ssl', () => ({
  buildDatabaseSsl: jest.fn(),
  stripSslParameters: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('DatabaseService', () => {
  const query = jest.fn();
  const end = jest.fn();
  let service: DatabaseService;

  beforeEach(() => {
    jest.resetAllMocks();
    query.mockResolvedValue({ rows: [] });
    end.mockResolvedValue(undefined);
    (Pool as unknown as jest.Mock).mockImplementation(() => ({ query, end }));
    (buildDatabaseSsl as jest.Mock).mockReturnValue(false);
    service = new DatabaseService('postgresql://user:pw@db:5432/secretly');
  });

  describe('constructor', () => {
    it('connects with the connection string as given when ssl is not configured', () => {
      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
        connectionString: 'postgresql://user:pw@db:5432/secretly',
        ssl: false,
        max: 20,
      }));
      expect(stripSslParameters).not.toHaveBeenCalled();
    });

    it('strips ssl parameters from the connection string when ssl is configured', () => {
      const ssl = { rejectUnauthorized: true };
      (buildDatabaseSsl as jest.Mock).mockReturnValue(ssl);
      (stripSslParameters as jest.Mock).mockReturnValue('postgresql://user:pw@db:5432/secretly');
      (Pool as unknown as jest.Mock).mockClear();

      new DatabaseService('postgresql://user:pw@db:5432/secretly?sslmode=require');

      expect(stripSslParameters).toHaveBeenCalledWith('postgresql://user:pw@db:5432/secretly?sslmode=require');
      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
        connectionString: 'postgresql://user:pw@db:5432/secretly',
        ssl,
      }));
    });
  });

  describe('initialize', () => {
    it('creates every table', async () => {
      await service.initialize();
      const statements = query.mock.calls.map(([sql]) => sql as string);
      expect(statements).toHaveLength(4);
      ['obfuscation_records', 'audit_logs', 'channel_configs', 'user_permissions'].forEach(table => {
        expect(statements.some(sql => sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`))).toBe(true);
      });
      expect(logger.info).toHaveBeenCalledWith('Database initialized successfully');
    });

    it('keeps creating the remaining tables when one statement fails', async () => {
      query.mockRejectedValueOnce(new Error('syntax error'));
      await expect(service.initialize()).resolves.toBeUndefined();
      expect(query).toHaveBeenCalledTimes(4);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('rethrows when initialization fails', async () => {
      (logger.info as jest.Mock).mockImplementationOnce(() => {
        throw new Error('logger broke');
      });
      await expect(service.initialize()).rejects.toThrow('logger broke');
    });
  });

  describe('obfuscation records', () => {
    it('stores a record', async () => {
      const createdAt = new Date('2026-01-01T00:00:00Z');
      await service.storeObfuscationRecord({
        id: 'rec1',
        messageTs: '1.2',
        channelId: 'C1',
        userId: 'U1',
        originalContent: 'encrypted',
        obfuscatedContent: 'masked',
        detectionType: [{ type: 'ssn' }],
        severity: 'high',
        createdAt,
      });
      expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO obfuscation_records'), [
        'rec1', '1.2', 'C1', 'U1', 'encrypted', 'masked', '[{"type":"ssn"}]', 'high', createdAt,
      ]);
    });

    it('returns the record for an id', async () => {
      query.mockResolvedValue({ rows: [{ id: 'rec1' }] });
      await expect(service.getObfuscationRecord('rec1')).resolves.toEqual({ id: 'rec1' });
      expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), ['rec1']);
    });

    it('returns undefined for an unknown id', async () => {
      await expect(service.getObfuscationRecord('missing')).resolves.toBeUndefined();
    });

    it('marks a record dismissed by a user', async () => {
      await service.markObfuscationDismissed('rec1', 'U2');
      expect(query).toHaveBeenCalledWith(expect.stringContaining('SET dismissed_at = NOW(), dismissed_by = $2'), ['rec1', 'U2']);
    });

    it('deletes records older than the retention period', async () => {
      await service.cleanupOldRecords(30);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('INTERVAL \'30 days\''));
    });
  });

  describe('channel configs', () => {
    it('returns a stored config', async () => {
      const row = { channel_id: 'C1', enabled: false };
      query.mockResolvedValue({ rows: [row] });
      await expect(service.getChannelConfig('C1')).resolves.toBe(row);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('creates and returns the default config for an unknown channel', async () => {
      const config = await service.getChannelConfig('C9');
      expect(config).toEqual({
        channelId: 'C9',
        enabled: true,
        sensitivityLevel: 'medium',
        enabledDetectors: ['credit_card', 'ssn', 'api_key', 'password'],
        detectHighEntropy: true,
        entropyThreshold: 4.5,
        exemptedUsers: [],
      });
      expect(query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO channel_configs'), [
        'C9', true, 'medium', ['credit_card', 'ssn', 'api_key', 'password'], true, 4.5, [],
      ]);
    });

    it('upserts a config', async () => {
      await service.createChannelConfig({
        channelId: 'C1',
        enabled: false,
        sensitivityLevel: 'high',
        enabledDetectors: ['ssn'],
        detectHighEntropy: false,
        entropyThreshold: 3,
        exemptedUsers: ['U1'],
      });
      expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (channel_id) DO UPDATE'), [
        'C1', false, 'high', ['ssn'], false, 3, ['U1'],
      ]);
    });
  });

  describe('user permissions', () => {
    it('returns the stored permissions', async () => {
      const row = { user_id: 'U1', is_admin: true };
      query.mockResolvedValue({ rows: [row] });
      await expect(service.getUserPermissions('U1', 'C1')).resolves.toBe(row);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM user_permissions'), ['U1', 'C1']);
    });

    it('returns no permissions for a user without a stored row', async () => {
      await expect(service.getUserPermissions('U1', 'C1')).resolves.toEqual({
        canDismissLow: false,
        canDismissMedium: false,
        canDismissHigh: false,
        canDismissCritical: false,
        isAdmin: false,
      });
    });

    it('upserts permissions', async () => {
      await service.setUserPermissions('U1', 'C1', {
        canDismissLow: true,
        canDismissMedium: false,
        canDismissHigh: true,
        canDismissCritical: false,
        isAdmin: false,
      });
      expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (user_id, channel_id) DO UPDATE'), [
        'U1', 'C1', true, false, true, false, false,
      ]);
    });
  });

  describe('audit logs', () => {
    it('stores the metadata as JSON', async () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      await service.addAuditLog({
        action: 'dismissal', userId: 'U1', channelId: 'C1', recordId: 'rec1', metadata: { dismissedBy: 'U2' }, timestamp,
      });
      expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'), [
        'dismissal', 'U1', 'C1', 'rec1', '{"dismissedBy":"U2"}', timestamp,
      ]);
    });
  });

  it('closes the connection pool', async () => {
    await service.close();
    expect(end).toHaveBeenCalled();
  });
});
