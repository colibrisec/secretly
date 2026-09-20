import { App, SayFn } from '@slack/bolt';
import { GenericMessageEvent } from '@slack/types';
import { MessageHandler } from './message.handler';
import { detectSensitiveData, detectHighEntropyStrings } from '../detectors/patterns';
import { ObfuscationService } from '../services/obfuscation.service';
import { AuditService } from '../services/audit.service';
import { PermissionService } from '../services/permission.service';
import { ChannelConfigService } from '../services/channel-config.service';
import { DatabaseService } from '../services/database.service';
import { RateLimiter } from '../utils/rate-limiter';

jest.mock('../detectors/patterns');
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedDetectSensitiveData = detectSensitiveData as jest.Mock;
const mockedDetectHighEntropyStrings = detectHighEntropyStrings as jest.Mock;

interface Block {
  type: string;
  fields?: Array<{ text: string }>;
  elements?: Array<{ action_id?: string; value?: string; text?: string }>;
}

const detection = (type: string, severity: string, match: string, index: number) => ({
  match,
  index,
  pattern: { type, severity, description: `${type} description` },
});

describe('MessageHandler', () => {
  const update = jest.fn();
  const postEphemeral = jest.fn();
  const obfuscateText = jest.fn();
  const generateId = jest.fn();
  const encrypt = jest.fn();
  const decrypt = jest.fn();
  const logObfuscation = jest.fn();
  const logDismissal = jest.fn();
  const logError = jest.fn();
  const canUserDismiss = jest.fn();
  const isUserExempted = jest.fn();
  const getChannelConfig = jest.fn();
  const storeObfuscationRecord = jest.fn();
  const getObfuscationRecord = jest.fn();
  const markObfuscationDismissed = jest.fn();
  const checkLimit = jest.fn();
  let handler: MessageHandler;

  const channelConfig = {
    enabled: true,
    enabledDetectors: ['ssn', 'api_key'],
    detectHighEntropy: false,
    entropyThreshold: 4.5,
  };
  const event = { channel: 'C1', user: 'U1', ts: '1.2', text: 'my ssn is 123-45-6789' } as unknown as GenericMessageEvent;
  const say = jest.fn() as unknown as SayFn;

  beforeEach(() => {
    jest.resetAllMocks();
    checkLimit.mockResolvedValue({ allowed: true });
    getChannelConfig.mockResolvedValue(channelConfig);
    isUserExempted.mockResolvedValue(false);
    mockedDetectSensitiveData.mockReturnValue([]);
    mockedDetectHighEntropyStrings.mockReturnValue([]);
    obfuscateText.mockReturnValue({ obfuscated: 'my ssn is [SSN-XXX-XX-XXXX]' });
    generateId.mockReturnValue('rec1');
    encrypt.mockReturnValue('encrypted-text');
    decrypt.mockReturnValue('original text');

    handler = new MessageHandler(
      { client: { chat: { update, postEphemeral } } } as unknown as App,
      { obfuscateText, generateId, encrypt, decrypt } as unknown as ObfuscationService,
      { logObfuscation, logDismissal, logError } as unknown as AuditService,
      { canUserDismiss, isUserExempted } as unknown as PermissionService,
      { getChannelConfig } as unknown as ChannelConfigService,
      { storeObfuscationRecord, getObfuscationRecord, markObfuscationDismissed } as unknown as DatabaseService,
      { checkLimit } as unknown as RateLimiter
    );
  });

  describe('handleMessage', () => {
    it.each([
      ['has no text', { channel: 'C1', user: 'U1', ts: '1.2' }],
      ['has empty text', { channel: 'C1', user: 'U1', ts: '1.2', text: '' }],
      ['comes from a bot', { channel: 'C1', user: 'U1', ts: '1.2', text: 'x', subtype: 'bot_message' }],
    ])('ignores a message that %s', async (_name, ignored) => {
      await handler.handleMessage(ignored as unknown as GenericMessageEvent, say);
      expect(checkLimit).not.toHaveBeenCalled();
    });

    it('stops when the user is rate limited', async () => {
      checkLimit.mockResolvedValue({ allowed: false });
      await handler.handleMessage(event, say);
      expect(checkLimit).toHaveBeenCalledWith('U1', 'C1');
      expect(getChannelConfig).not.toHaveBeenCalled();
    });

    it('stops when scanning is disabled for the channel', async () => {
      getChannelConfig.mockResolvedValue({ ...channelConfig, enabled: false });
      await handler.handleMessage(event, say);
      expect(isUserExempted).not.toHaveBeenCalled();
    });

    it('stops when the user is exempted', async () => {
      isUserExempted.mockResolvedValue(true);
      await handler.handleMessage(event, say);
      expect(isUserExempted).toHaveBeenCalledWith('U1', 'C1');
      expect(mockedDetectSensitiveData).not.toHaveBeenCalled();
    });

    it('leaves a message without detections untouched', async () => {
      await handler.handleMessage(event, say);
      expect(mockedDetectSensitiveData).toHaveBeenCalledWith(event.text, channelConfig.enabledDetectors);
      expect(update).not.toHaveBeenCalled();
      expect(storeObfuscationRecord).not.toHaveBeenCalled();
    });

    describe('with detections', () => {
      beforeEach(() => {
        mockedDetectSensitiveData.mockReturnValue([
          detection('ssn', 'high', '123-45-6789', 10),
          detection('api_key', 'critical', 'AKIAIOSFODNN7EXAMPLE', 30),
          detection('ssn', 'low', '987-65-4321', 50),
        ]);
      });

      it('obfuscates the matches found in the text', async () => {
        await handler.handleMessage(event, say);
        expect(obfuscateText).toHaveBeenCalledWith(event.text, [
          { match: '123-45-6789', index: 10, type: 'ssn' },
          { match: 'AKIAIOSFODNN7EXAMPLE', index: 30, type: 'api_key' },
          { match: '987-65-4321', index: 50, type: 'ssn' },
        ]);
      });

      it('stores the encrypted original with the highest severity found', async () => {
        await handler.handleMessage(event, say);
        expect(encrypt).toHaveBeenCalledWith(event.text);
        expect(storeObfuscationRecord).toHaveBeenCalledWith(expect.objectContaining({
          id: 'rec1',
          messageTs: '1.2',
          channelId: 'C1',
          userId: 'U1',
          originalContent: 'encrypted-text',
          obfuscatedContent: 'my ssn is [SSN-XXX-XX-XXXX]',
          severity: 'critical',
          createdAt: expect.any(Date),
        }));
        const stored = storeObfuscationRecord.mock.calls[0][0];
        expect(JSON.parse(stored.detectionType)).toHaveLength(3);
      });

      it('replaces the original message with the obfuscated text', async () => {
        await handler.handleMessage(event, say);
        expect(update).toHaveBeenCalledWith({ channel: 'C1', ts: '1.2', text: 'my ssn is [SSN-XXX-XX-XXXX]' });
      });

      it('tells the author what was obfuscated, with a dismiss button for the record', async () => {
        await handler.handleMessage(event, say);
        const message = postEphemeral.mock.calls[0][0];
        expect(message).toMatchObject({ channel: 'C1', user: 'U1', thread_ts: '1.2' });
        expect(message.text).toContain('rec1');
        expect(message.text).toContain('2 ssn(s)');
        expect(message.text).toContain('1 api key(s)');

        const actions = (message.blocks as Block[]).find(b => b.type === 'actions')!;
        const dismiss = actions.elements!.find(e => e.action_id === 'dismiss_obfuscation')!;
        expect(dismiss.value).toBe('rec1');
        expect(actions.elements!.some(e => e.action_id === 'view_guidelines')).toBe(true);

        const fields = (message.blocks as Block[]).find(b => b.fields)!.fields!.map(f => f.text);
        expect(fields).toEqual(['*SSN:* 2', '*API KEY:* 1']);

        const context = (message.blocks as Block[]).find(b => b.type === 'context')!;
        expect(context.elements![0].text).toContain('Severity: *critical*');
      });

      it('writes an audit entry for the obfuscation', async () => {
        await handler.handleMessage(event, say);
        expect(logObfuscation).toHaveBeenCalledWith(expect.objectContaining({
          recordId: 'rec1',
          userId: 'U1',
          channelId: 'C1',
          messageTs: '1.2',
          action: 'obfuscated',
          detections: expect.arrayContaining([expect.objectContaining({ type: 'ssn', severity: 'high' })]),
        }));
      });

      it('does not scan for high entropy strings when the channel has it off', async () => {
        await handler.handleMessage(event, say);
        expect(mockedDetectHighEntropyStrings).not.toHaveBeenCalled();
      });
    });

    describe('with high entropy detection enabled', () => {
      beforeEach(() => {
        getChannelConfig.mockResolvedValue({ ...channelConfig, detectHighEntropy: true, entropyThreshold: 4 });
      });

      it('obfuscates high entropy strings even without pattern matches', async () => {
        mockedDetectHighEntropyStrings.mockReturnValue(['x9Qz7Lm2Vb8Nc4Rt']);
        await handler.handleMessage({ ...event, text: 'token x9Qz7Lm2Vb8Nc4Rt here' }, say);
        expect(mockedDetectHighEntropyStrings).toHaveBeenCalledWith('token x9Qz7Lm2Vb8Nc4Rt here', 4);
        expect(obfuscateText).toHaveBeenCalledWith('token x9Qz7Lm2Vb8Nc4Rt here', [
          { match: 'x9Qz7Lm2Vb8Nc4Rt', index: 6, type: 'high_entropy' },
        ]);
        expect(storeObfuscationRecord).toHaveBeenCalledWith(expect.objectContaining({ severity: 'medium' }));
      });

      it('leaves the message alone when there is nothing to obfuscate', async () => {
        await handler.handleMessage(event, say);
        expect(update).not.toHaveBeenCalled();
      });
    });

    describe('when handling fails', () => {
      beforeEach(() => {
        mockedDetectSensitiveData.mockReturnValue([detection('ssn', 'high', '123-45-6789', 10)]);
      });

      it('records the error instead of throwing', async () => {
        storeObfuscationRecord.mockRejectedValue(new Error('write failed'));
        await expect(handler.handleMessage(event, say)).resolves.toBeUndefined();
        expect(update).not.toHaveBeenCalled();
        expect(logError).toHaveBeenCalledWith({
          userId: 'U1',
          channelId: 'C1',
          messageTs: '1.2',
          error: 'write failed',
          timestamp: expect.any(Date),
        });
      });

      it('reports an unknown error when a non-error value is thrown', async () => {
        storeObfuscationRecord.mockRejectedValue('nope');
        await handler.handleMessage(event, say);
        expect(logError).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unknown error' }));
      });
    });
  });

  describe('handleDismissal', () => {
    const record = { channelId: 'C1', messageTs: '1.2', severity: 'high', originalContent: 'encrypted-text' };

    it('rejects an unknown record', async () => {
      getObfuscationRecord.mockResolvedValue(undefined);
      await expect(handler.handleDismissal('missing', 'U2')).rejects.toThrow('Obfuscation record not found');
      expect(canUserDismiss).not.toHaveBeenCalled();
    });

    it('tells a user without permission and leaves the message obfuscated', async () => {
      getObfuscationRecord.mockResolvedValue(record);
      canUserDismiss.mockResolvedValue(false);
      await handler.handleDismissal('rec1', 'U2');
      expect(canUserDismiss).toHaveBeenCalledWith('U2', 'C1', 'high');
      expect(postEphemeral).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'C1',
        user: 'U2',
        text: expect.stringContaining('do not have permission'),
      }));
      expect(update).not.toHaveBeenCalled();
      expect(markObfuscationDismissed).not.toHaveBeenCalled();
    });

    it('restores the original message, marks the record and audits the dismissal', async () => {
      getObfuscationRecord.mockResolvedValue(record);
      canUserDismiss.mockResolvedValue(true);
      await handler.handleDismissal('rec1', 'U2');
      expect(decrypt).toHaveBeenCalledWith('encrypted-text');
      expect(update).toHaveBeenCalledWith({ channel: 'C1', ts: '1.2', text: 'original text' });
      expect(markObfuscationDismissed).toHaveBeenCalledWith('rec1', 'U2');
      expect(logDismissal).toHaveBeenCalledWith(expect.objectContaining({
        recordId: 'rec1',
        userId: 'U2',
        channelId: 'C1',
        messageTs: '1.2',
        dismissedBy: 'U2',
      }));
      expect(postEphemeral).toHaveBeenCalledWith(expect.objectContaining({
        user: 'U2',
        text: expect.stringContaining('dismissed'),
      }));
    });

    it('rethrows when the original message cannot be restored', async () => {
      getObfuscationRecord.mockResolvedValue(record);
      canUserDismiss.mockResolvedValue(true);
      update.mockRejectedValue(new Error('slack down'));
      await expect(handler.handleDismissal('rec1', 'U2')).rejects.toThrow('slack down');
      expect(markObfuscationDismissed).not.toHaveBeenCalled();
    });
  });
});
