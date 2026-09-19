import { DatabaseService } from './database.service';
import { PermissionService } from './permission.service';

jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({ conversations: { members: jest.fn() } })),
}));

jest.mock('../utils/secrets', () => ({
  getRequiredSecret: jest.fn().mockReturnValue('bot-token'),
}));

jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function permissionsWith(overrides: Record<string, boolean>) {
  return {
    canDismissLow: false,
    canDismissMedium: false,
    canDismissHigh: false,
    canDismissCritical: false,
    isAdmin: false,
    ...overrides,
  };
}

describe('PermissionService', () => {
  const getUserPermissions = jest.fn();
  const getChannelConfig = jest.fn();
  const databaseService = { getUserPermissions, getChannelConfig } as unknown as DatabaseService;
  let service: PermissionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PermissionService(databaseService);
  });

  describe('canUserDismiss', () => {
    it.each([
      ['low', 'canDismissLow'],
      ['medium', 'canDismissMedium'],
      ['high', 'canDismissHigh'],
      ['critical', 'canDismissCritical'],
    ])('allows %s severity with the matching permission', async (severity, permission) => {
      getUserPermissions.mockResolvedValue(permissionsWith({ [permission]: true }));
      await expect(service.canUserDismiss('U1', 'C1', severity)).resolves.toBe(true);
    });

    it('denies a severity the user has no permission for', async () => {
      getUserPermissions.mockResolvedValue(permissionsWith({ canDismissLow: true }));
      await expect(service.canUserDismiss('U1', 'C1', 'medium')).resolves.toBe(false);
    });

    it('allows an admin at every severity', async () => {
      getUserPermissions.mockResolvedValue(permissionsWith({ isAdmin: true }));
      await expect(service.canUserDismiss('U1', 'C1', 'critical')).resolves.toBe(true);
    });

    it('denies an unknown severity', async () => {
      getUserPermissions.mockResolvedValue(permissionsWith({ isAdmin: true }));
      await expect(service.canUserDismiss('U1', 'C1', 'unknown')).resolves.toBe(false);
    });

    it('denies when the permission lookup fails', async () => {
      getUserPermissions.mockRejectedValue(new Error('database down'));
      await expect(service.canUserDismiss('U1', 'C1', 'low')).resolves.toBe(false);
    });
  });

  describe('isUserExempted', () => {
    it('is true when the user is in the exempted list', async () => {
      getChannelConfig.mockResolvedValue({ exemptedUsers: ['U1', 'U2'] });
      await expect(service.isUserExempted('U1', 'C1')).resolves.toBe(true);
    });

    it('is false when the user is not in the exempted list', async () => {
      getChannelConfig.mockResolvedValue({ exemptedUsers: ['U2'] });
      await expect(service.isUserExempted('U1', 'C1')).resolves.toBe(false);
    });

    it('is false when the channel has no exempted list', async () => {
      getChannelConfig.mockResolvedValue({});
      await expect(service.isUserExempted('U1', 'C1')).resolves.toBe(false);
    });

    it('is false when the config lookup fails', async () => {
      getChannelConfig.mockRejectedValue(new Error('database down'));
      await expect(service.isUserExempted('U1', 'C1')).resolves.toBe(false);
    });
  });
});
