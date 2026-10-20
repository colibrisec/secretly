import { DatabaseService } from './database.service';
import { PermissionService } from './permission.service';

const mockSlack = {
  conversations: { members: jest.fn(), info: jest.fn() },
  users: { info: jest.fn() },
};

jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => mockSlack),
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
  const setUserPermissions = jest.fn();
  const databaseService = { getUserPermissions, getChannelConfig, setUserPermissions } as unknown as DatabaseService;
  let service: PermissionService;

  beforeEach(() => {
    jest.clearAllMocks();
    setUserPermissions.mockResolvedValue(undefined);
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

    it.each(['low', 'medium', 'high', 'critical'])('allows an admin at %s severity', async severity => {
      getUserPermissions.mockResolvedValue(permissionsWith({ isAdmin: true }));
      await expect(service.canUserDismiss('U1', 'C1', severity)).resolves.toBe(true);
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

  describe('isChannelAdmin', () => {
    const members = ['U1', 'U2', 'U3'];

    beforeEach(() => {
      getUserPermissions.mockResolvedValue(permissionsWith({}));
      mockSlack.conversations.members.mockResolvedValue({ members });
      mockSlack.conversations.info.mockResolvedValue({ channel: { creator: 'U9' } });
      mockSlack.users.info.mockResolvedValue({ user: {} });
    });

    it('is true for a stored admin without asking Slack', async () => {
      getUserPermissions.mockResolvedValue(permissionsWith({ isAdmin: true }));
      await expect(service.isChannelAdmin('U1', 'C1')).resolves.toBe(true);
      expect(mockSlack.conversations.info).not.toHaveBeenCalled();
    });

    it('is true for a workspace admin in the channel', async () => {
      mockSlack.users.info.mockImplementation(async ({ user }: { user: string }) => ({ user: { is_admin: user === 'U2' } }));
      await expect(service.isChannelAdmin('U2', 'C1')).resolves.toBe(true);
    });

    it('is true for a workspace owner in the channel', async () => {
      mockSlack.users.info.mockImplementation(async ({ user }: { user: string }) => ({ user: { is_owner: user === 'U3' } }));
      await expect(service.isChannelAdmin('U3', 'C1')).resolves.toBe(true);
    });

    it('is true for the channel creator', async () => {
      await expect(service.isChannelAdmin('U9', 'C1')).resolves.toBe(true);
    });

    it('is false for an ordinary member', async () => {
      await expect(service.isChannelAdmin('U1', 'C1')).resolves.toBe(false);
    });

    it('is false for a channel without a creator', async () => {
      mockSlack.conversations.info.mockResolvedValue({ channel: {} });
      await expect(service.isChannelAdmin('U9', 'C1')).resolves.toBe(false);
    });

    it('is false when the channel does not exist', async () => {
      mockSlack.conversations.info.mockResolvedValue({});
      await expect(service.isChannelAdmin('U9', 'C1')).resolves.toBe(false);
    });

    it('is false when the channel has no member list', async () => {
      mockSlack.conversations.members
        .mockResolvedValueOnce({ members })
        .mockResolvedValueOnce({});
      await expect(service.isChannelAdmin('U1', 'C1')).resolves.toBe(false);
    });

    it('is false when a member cannot be looked up', async () => {
      mockSlack.users.info.mockRejectedValue(new Error('slack down'));
      await expect(service.isChannelAdmin('U1', 'C1')).resolves.toBe(false);
    });

    it('is false when the permission lookup fails', async () => {
      getUserPermissions.mockRejectedValue(new Error('database down'));
      await expect(service.isChannelAdmin('U1', 'C1')).resolves.toBe(false);
    });
  });

  describe('grantDismissalPermission', () => {
    it.each([
      ['low', 'canDismissLow'],
      ['medium', 'canDismissMedium'],
      ['high', 'canDismissHigh'],
      ['critical', 'canDismissCritical'],
    ])('grants %s severity and keeps the other permissions', async (severity, permission) => {
      getUserPermissions.mockResolvedValue(permissionsWith({ isAdmin: true }));
      await service.grantDismissalPermission('U1', 'C1', severity, 'U9');
      expect(setUserPermissions).toHaveBeenCalledWith('U1', 'C1', permissionsWith({ isAdmin: true, [permission]: true }));
    });

    it('leaves the permissions unchanged for an unknown severity', async () => {
      getUserPermissions.mockResolvedValue(permissionsWith({ canDismissLow: true }));
      await service.grantDismissalPermission('U1', 'C1', 'unknown', 'U9');
      expect(setUserPermissions).toHaveBeenCalledWith('U1', 'C1', permissionsWith({ canDismissLow: true }));
    });

    it('rethrows when the permissions cannot be stored', async () => {
      getUserPermissions.mockResolvedValue(permissionsWith({}));
      setUserPermissions.mockRejectedValue(new Error('write failed'));
      await expect(service.grantDismissalPermission('U1', 'C1', 'low', 'U9')).rejects.toThrow('write failed');
    });
  });

  describe('revokeDismissalPermission', () => {
    const everything = permissionsWith({
      canDismissLow: true, canDismissMedium: true, canDismissHigh: true, canDismissCritical: true,
    });

    it.each([
      ['low', 'canDismissLow'],
      ['medium', 'canDismissMedium'],
      ['high', 'canDismissHigh'],
      ['critical', 'canDismissCritical'],
    ])('revokes %s severity and keeps the other permissions', async (severity, permission) => {
      getUserPermissions.mockResolvedValue(everything);
      await service.revokeDismissalPermission('U1', 'C1', severity, 'U9');
      expect(setUserPermissions).toHaveBeenCalledWith('U1', 'C1', { ...everything, [permission]: false });
    });

    it('leaves the permissions unchanged for an unknown severity', async () => {
      getUserPermissions.mockResolvedValue(everything);
      await service.revokeDismissalPermission('U1', 'C1', 'unknown', 'U9');
      expect(setUserPermissions).toHaveBeenCalledWith('U1', 'C1', everything);
    });

    it('rethrows when the permissions cannot be stored', async () => {
      getUserPermissions.mockResolvedValue(everything);
      setUserPermissions.mockRejectedValue(new Error('write failed'));
      await expect(service.revokeDismissalPermission('U1', 'C1', 'low', 'U9')).rejects.toThrow('write failed');
    });
  });

  describe('setAdminStatus', () => {
    it.each([true, false])('sets admin to %s and keeps the other permissions', async isAdmin => {
      getUserPermissions.mockResolvedValue(permissionsWith({ canDismissLow: true, isAdmin: !isAdmin }));
      await service.setAdminStatus('U1', 'C1', isAdmin, 'U9');
      expect(setUserPermissions).toHaveBeenCalledWith('U1', 'C1', permissionsWith({ canDismissLow: true, isAdmin }));
    });

    it('rethrows when the permissions cannot be stored', async () => {
      getUserPermissions.mockResolvedValue(permissionsWith({}));
      setUserPermissions.mockRejectedValue(new Error('write failed'));
      await expect(service.setAdminStatus('U1', 'C1', true, 'U9')).rejects.toThrow('write failed');
    });
  });
});
