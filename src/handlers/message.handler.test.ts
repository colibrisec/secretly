import { App, SayFn } from '@slack/bolt';
import { GenericMessageEvent } from '@slack/types';
import { MessageHandler, toScannableMessage } from './message.handler';
import { detectSensitiveData, detectHighEntropyStrings } from '../detectors/patterns';
import { ObfuscationService } from '../services/obfuscation.service';
import { AuditService } from '../services/audit.service';
import { PermissionService } from '../services/permission.service';
import { ChannelConfigService } from '../services/channel-config.service';
import { DatabaseService } from '../services/database.service';
import { RateLimiter } from '../utils/rate-limiter';
import * as metrics from '../utils/metrics';

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
  const postMessage = jest.fn();
  const botDelete = jest.fn();
  const usersInfo = jest.fn();
  const adminDelete = jest.fn();
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
  const setRepostTs = jest.fn();
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

    adminDelete.mockResolvedValue({ ok: true });
    postMessage.mockResolvedValue({ ok: true, ts: '9.9' });
    botDelete.mockResolvedValue({ ok: true });
    usersInfo.mockResolvedValue({ user: { name: 'ada', profile: { display_name: 'Ada', image_72: 'https://img/ada.png' } } });

    handler = new MessageHandler(
      { client: { chat: { postMessage, postEphemeral, delete: botDelete }, users: { info: usersInfo } } } as unknown as App,
      { obfuscateText, generateId, encrypt, decrypt } as unknown as ObfuscationService,
      { logObfuscation, logDismissal, logError } as unknown as AuditService,
      { canUserDismiss, isUserExempted } as unknown as PermissionService,
      { getChannelConfig } as unknown as ChannelConfigService,
      { storeObfuscationRecord, getObfuscationRecord, markObfuscationDismissed, setRepostTs } as unknown as DatabaseService,
      { checkLimit } as unknown as RateLimiter,
      { chat: { delete: adminDelete } }
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
      expect(postMessage).not.toHaveBeenCalled();
      expect(storeObfuscationRecord).not.toHaveBeenCalled();
      expect(adminDelete).not.toHaveBeenCalled();
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
        expect(stored.detectionType).toEqual([
          expect.objectContaining({ type: 'ssn', severity: 'high', index: 10, length: 11 }),
          expect.objectContaining({ type: 'api_key', severity: 'critical', index: 30, length: 20 }),
          expect.objectContaining({ type: 'ssn', severity: 'low', index: 50, length: 11 }),
        ]);
      });

      it('never stores or audits the matched secrets in plaintext', async () => {
        await handler.handleMessage(event, say);
        const stored = JSON.stringify(storeObfuscationRecord.mock.calls[0][0].detectionType);
        const audited = JSON.stringify(logObfuscation.mock.calls[0][0].detections);
        for (const secret of ['123-45-6789', 'AKIAIOSFODNN7EXAMPLE', '987-65-4321']) {
          expect(stored).not.toContain(secret);
          expect(audited).not.toContain(secret);
        }
      });

      it('uses real line breaks in the ephemeral text', async () => {
        await handler.handleMessage(event, say);
        const { text } = postEphemeral.mock.calls[0][0];
        expect(text).toContain('\n');
        expect(text).not.toContain('\\n');
      });

      it('deletes the original with the admin token, then reposts the masked text as the author', async () => {
        await handler.handleMessage(event, say);
        expect(adminDelete).toHaveBeenCalledWith({ channel: 'C1', ts: '1.2' });
        expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
          channel: 'C1',
          text: 'my ssn is [SSN-XXX-XX-XXXX]',
          username: 'Ada',
          icon_url: 'https://img/ada.png',
          unfurl_links: false,
        }));
        const repost = postMessage.mock.calls[0][0];
        expect(repost.thread_ts).toBeUndefined();
        expect(JSON.stringify(repost.blocks)).toContain('Sent by <@U1>');
        expect(adminDelete.mock.invocationCallOrder[0]).toBeLessThan(postMessage.mock.invocationCallOrder[0]);
        expect(setRepostTs).toHaveBeenCalledWith('rec1', '9.9');
      });

      it('never reposts the original text', async () => {
        await handler.handleMessage(event, say);
        expect(JSON.stringify(postMessage.mock.calls)).not.toContain('123-45-6789');
      });

      it('keeps a thread reply in its thread', async () => {
        await handler.handleMessage({ ...event, thread_ts: '1.0' } as GenericMessageEvent, say);
        expect(storeObfuscationRecord).toHaveBeenCalledWith(expect.objectContaining({ threadTs: '1.0' }));
        expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ thread_ts: '1.0' }));
        expect(postEphemeral).toHaveBeenCalledWith(expect.objectContaining({ thread_ts: '1.0' }));
      });

      it('warns the author and does not repost when the original cannot be deleted', async () => {
        adminDelete.mockRejectedValue(new Error('cant_delete_message'));
        await handler.handleMessage(event, say);
        expect(postMessage).not.toHaveBeenCalled();
        expect(postEphemeral).toHaveBeenCalledTimes(1);
        expect(postEphemeral).toHaveBeenCalledWith(expect.objectContaining({
          channel: 'C1', user: 'U1', text: expect.stringContaining('could not be removed automatically'),
        }));
        expect(logError).toHaveBeenCalledWith(expect.objectContaining({
          messageTs: '1.2', error: 'Could not remove message: cant_delete_message',
        }));
        expect(logObfuscation).not.toHaveBeenCalled();
      });

      it('warns inside the thread when a reply cannot be deleted', async () => {
        adminDelete.mockRejectedValue(new Error('cant_delete_message'));
        await handler.handleMessage({ ...event, thread_ts: '1.0' } as GenericMessageEvent, say);
        expect(postEphemeral).toHaveBeenCalledWith(expect.objectContaining({ thread_ts: '1.0' }));
      });

      it('reports an unknown removal error for a non-error value', async () => {
        adminDelete.mockRejectedValue('nope');
        await handler.handleMessage(event, say);
        expect(logError).toHaveBeenCalledWith(expect.objectContaining({ error: 'Could not remove message: unknown error' }));
      });

      it('still tells the author and audits when the repost fails', async () => {
        postMessage.mockRejectedValue(new Error('slack down'));
        await handler.handleMessage(event, say);
        expect(adminDelete).toHaveBeenCalled();
        expect(setRepostTs).not.toHaveBeenCalled();
        expect(postEphemeral).toHaveBeenCalled();
        expect(logObfuscation).toHaveBeenCalled();
      });

      it('does not record a repost timestamp when Slack returns none', async () => {
        postMessage.mockResolvedValue({ ok: true });
        await handler.handleMessage(event, say);
        expect(setRepostTs).not.toHaveBeenCalled();
      });

      it('falls back to the bot identity when the author profile cannot be read', async () => {
        usersInfo.mockRejectedValue(new Error('users_not_found'));
        await handler.handleMessage(event, say);
        const repost = postMessage.mock.calls[0][0];
        expect(repost.username).toBeUndefined();
        expect(repost.icon_url).toBeUndefined();
        expect(JSON.stringify(repost.blocks)).toContain('Sent by <@U1>');
      });

      it('uses the real name, then the handle, when there is no display name', async () => {
        usersInfo.mockResolvedValueOnce({ user: { name: 'ada', profile: { real_name: 'Ada Lovelace' } } });
        await handler.handleMessage(event, say);
        expect(postMessage.mock.calls[0][0].username).toBe('Ada Lovelace');
        expect(postMessage.mock.calls[0][0].icon_url).toBeUndefined();

        usersInfo.mockResolvedValueOnce({ user: { name: 'ada', profile: {} } });
        await handler.handleMessage({ ...event, user: 'U7' } as GenericMessageEvent, say);
        expect(postMessage.mock.calls[1][0].username).toBe('ada');

        usersInfo.mockResolvedValueOnce({});
        await handler.handleMessage({ ...event, user: 'U8' } as GenericMessageEvent, say);
        expect(postMessage.mock.calls[2][0].username).toBeUndefined();
      });

      it('caches author profiles', async () => {
        await handler.handleMessage(event, say);
        await handler.handleMessage(event, say);
        expect(usersInfo).toHaveBeenCalledTimes(1);
      });

      it('tells the author what was obfuscated, with a dismiss button for the record', async () => {
        await handler.handleMessage(event, say);
        const message = postEphemeral.mock.calls[0][0];
        expect(message).toMatchObject({ channel: 'C1', user: 'U1' });
        expect(message.thread_ts).toBeUndefined();
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

      it('masks every occurrence of a repeated high entropy string', async () => {
        mockedDetectHighEntropyStrings.mockReturnValue(['x9Qz7Lm2Vb8Nc4Rt', 'x9Qz7Lm2Vb8Nc4Rt']);
        await handler.handleMessage({ ...event, text: 'x9Qz7Lm2Vb8Nc4Rt and x9Qz7Lm2Vb8Nc4Rt' }, say);
        expect(obfuscateText).toHaveBeenCalledWith('x9Qz7Lm2Vb8Nc4Rt and x9Qz7Lm2Vb8Nc4Rt', [
          { match: 'x9Qz7Lm2Vb8Nc4Rt', index: 0, type: 'high_entropy' },
          { match: 'x9Qz7Lm2Vb8Nc4Rt', index: 21, type: 'high_entropy' },
        ]);
      });

      it('leaves the message alone when there is nothing to obfuscate', async () => {
        await handler.handleMessage(event, say);
        expect(adminDelete).not.toHaveBeenCalled();
      });
    });

    describe('when handling fails', () => {
      beforeEach(() => {
        mockedDetectSensitiveData.mockReturnValue([detection('ssn', 'high', '123-45-6789', 10)]);
      });

      it('records the error instead of throwing', async () => {
        storeObfuscationRecord.mockRejectedValue(new Error('write failed'));
        await expect(handler.handleMessage(event, say)).resolves.toBeUndefined();
        expect(adminDelete).not.toHaveBeenCalled();
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
    const record = {
      channelId: 'C1', userId: 'U1', messageTs: '1.2', severity: 'high', originalContent: 'encrypted-text', repostTs: '9.9',
    };

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
      expect(postMessage).not.toHaveBeenCalled();
      expect(botDelete).not.toHaveBeenCalled();
      expect(markObfuscationDismissed).not.toHaveBeenCalled();
    });

    it('restores the original message, marks the record and audits the dismissal', async () => {
      getObfuscationRecord.mockResolvedValue(record);
      canUserDismiss.mockResolvedValue(true);
      await handler.handleDismissal('rec1', 'U2');
      expect(decrypt).toHaveBeenCalledWith('encrypted-text');
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'C1', text: 'original text', username: 'Ada',
      }));
      expect(JSON.stringify(postMessage.mock.calls[0][0].blocks)).toContain('restored by <@U2>');
      expect(botDelete).toHaveBeenCalledWith({ channel: 'C1', ts: '9.9' });
      expect(postMessage.mock.invocationCallOrder[0]).toBeLessThan(botDelete.mock.invocationCallOrder[0]);
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

    it('restores into the original thread and skips the delete when there is no masked copy', async () => {
      getObfuscationRecord.mockResolvedValue({ ...record, threadTs: '1.0', repostTs: undefined });
      canUserDismiss.mockResolvedValue(true);
      await handler.handleDismissal('rec1', 'U2');
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ thread_ts: '1.0' }));
      expect(botDelete).not.toHaveBeenCalled();
      expect(markObfuscationDismissed).toHaveBeenCalledWith('rec1', 'U2');
    });

    it('rethrows when the original message cannot be restored', async () => {
      getObfuscationRecord.mockResolvedValue(record);
      canUserDismiss.mockResolvedValue(true);
      postMessage.mockRejectedValue(new Error('slack down'));
      await expect(handler.handleDismissal('rec1', 'U2')).rejects.toThrow('slack down');
      expect(botDelete).not.toHaveBeenCalled();
      expect(markObfuscationDismissed).not.toHaveBeenCalled();
    });
  });

  describe('metrics', () => {
    const value = async (
      metric: { get: () => Promise<{ values: Array<{ value: number; labels: object }> }> },
      labels: Record<string, string> = {},
    ) => (await metric.get()).values
      .find(v => Object.entries(labels).every(([k, l]) => (v.labels as Record<string, string>)[k] === l))?.value ?? 0;
    const histogramCount = async () => (await metrics.messageDuration.get()).values
      .find(v => (v as { metricName?: string }).metricName === 'secretly_message_processing_duration_seconds_count')?.value ?? 0;

    beforeEach(() => metrics.registry.resetMetrics());

    it('counts scanned, obfuscated and detected values without channel or user labels', async () => {
      mockedDetectSensitiveData.mockReturnValue([
        detection('ssn', 'high', '123-45-6789', 10),
        detection('api_key', 'critical', 'AKIAIOSFODNN7EXAMPLE', 30),
      ]);
      await handler.handleMessage(event, say);
      expect(await value(metrics.messagesScanned)).toBe(1);
      expect(await value(metrics.messagesObfuscated, { severity: 'critical' })).toBe(1);
      expect(await value(metrics.detections, { type: 'ssn', severity: 'high' })).toBe(1);
      expect(await value(metrics.detections, { type: 'api_key', severity: 'critical' })).toBe(1);
      expect(await histogramCount()).toBe(1);
      const exposed = await metrics.registry.metrics();
      expect(exposed).not.toContain('C1');
      expect(exposed).not.toContain('U1');
    });

    it('counts a scanned message with no detections without counting an obfuscation', async () => {
      await handler.handleMessage(event, say);
      expect(await value(metrics.messagesScanned)).toBe(1);
      expect((await metrics.messagesObfuscated.get()).values).toHaveLength(0);
    });

    it.each([
      ['rate_limited', () => checkLimit.mockResolvedValue({ allowed: false })],
      ['channel_disabled', () => getChannelConfig.mockResolvedValue({ ...channelConfig, enabled: false })],
      ['user_exempted', () => isUserExempted.mockResolvedValue(true)],
    ])('counts a message skipped as %s', async (reason, setup) => {
      setup();
      await handler.handleMessage(event, say);
      expect(await value(metrics.messagesSkipped, { reason })).toBe(1);
      expect(await value(metrics.messagesScanned)).toBe(0);
    });

    it('counts processing errors', async () => {
      getChannelConfig.mockRejectedValue(new Error('db down'));
      await handler.handleMessage(event, say);
      expect(await value(metrics.messageErrors)).toBe(1);
      expect(await histogramCount()).toBe(1);
    });

    it('does not time ignored bot messages', async () => {
      await handler.handleMessage({ ...event, subtype: 'bot_message' } as unknown as GenericMessageEvent, say);
      expect(await histogramCount()).toBe(0);
    });

    it.each([
      ['dismissed', true, undefined],
      ['denied', false, undefined],
      ['error', true, new Error('slack down')],
    ])('counts a %s dismissal', async (outcome, allowed, failure) => {
      getObfuscationRecord.mockResolvedValue({ channelId: 'C1', messageTs: '1.2', severity: 'high', originalContent: 'x' });
      canUserDismiss.mockResolvedValue(allowed);
      if (failure) {
        postMessage.mockRejectedValue(failure);
      }
      await handler.handleDismissal('rec1', 'U2').catch(() => undefined);
      expect(await value(metrics.dismissals, { outcome })).toBe(1);
    });
  });
});

describe('toScannableMessage', () => {
  const base = { channel: 'C1', user: 'U1', ts: '1.2', text: 'hello' };

  it('passes a new message through', () => {
    expect(toScannableMessage(base)).toEqual({ ...base, thread_ts: undefined });
  });

  it('keeps the thread of a reply', () => {
    expect(toScannableMessage({ ...base, thread_ts: '1.0' })?.thread_ts).toBe('1.0');
  });

  it.each([
    ['nothing', undefined],
    ['a bot message', { ...base, bot_id: 'B1' }],
    ['a message without text', { ...base, text: '' }],
    ['a message without a user', { ...base, user: undefined }],
    ['another subtype', { ...base, subtype: 'channel_join' }],
  ])('ignores %s', (_name, event) => {
    expect(toScannableMessage(event)).toBeNull();
  });

  describe('edits', () => {
    const edit = (message: object, previous: object = { text: 'before' }) => ({
      subtype: 'message_changed', channel: 'C1', message, previous_message: previous,
    });

    it('scans the edited text', () => {
      expect(toScannableMessage(edit({ user: 'U1', ts: '1.2', text: 'now with a secret', thread_ts: '1.0' }))).toEqual({
        channel: 'C1', user: 'U1', ts: '1.2', text: 'now with a secret', thread_ts: '1.0',
      });
    });

    it.each([
      ['no message', undefined],
      ['a bot message', { user: 'U1', ts: '1.2', text: 'x', bot_id: 'B1' }],
      ['a message with a subtype', { user: 'U1', ts: '1.2', text: 'x', subtype: 'bot_message' }],
      ['an empty message', { user: 'U1', ts: '1.2', text: '' }],
      ['a message without a user', { ts: '1.2', text: 'x' }],
    ])('ignores an edit with %s', (_name, message) => {
      expect(toScannableMessage(edit(message as object))).toBeNull();
    });

    it('ignores an edit that leaves the text unchanged, such as an unfurl', () => {
      expect(toScannableMessage(edit({ user: 'U1', ts: '1.2', text: 'same' }, { text: 'same' }))).toBeNull();
    });

    it('scans an edit without a previous message', () => {
      expect(toScannableMessage({ subtype: 'message_changed', channel: 'C1', message: { user: 'U1', ts: '1.2', text: 'x' } })).not.toBeNull();
    });
  });
});
