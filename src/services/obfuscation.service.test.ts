import { ObfuscationService } from './obfuscation.service';

const encryptionKey = 'k'.repeat(32);

function createService(): ObfuscationService {
  return new ObfuscationService(encryptionKey);
}

describe('ObfuscationService construction', () => {
  it('rejects an encryption key shorter than 32 characters', () => {
    expect(() => new ObfuscationService('short')).toThrow('at least 32 characters');
  });

  it('rejects an empty encryption key', () => {
    expect(() => new ObfuscationService('')).toThrow('at least 32 characters');
  });
});

describe('generateId', () => {
  it('returns 32 hexadecimal characters', () => {
    expect(createService().generateId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns a different id each time', () => {
    const service = createService();
    expect(service.generateId()).not.toBe(service.generateId());
  });
});

describe('encrypt and decrypt', () => {
  it('restores the original text', () => {
    const service = createService();
    expect(service.decrypt(service.encrypt('4111111111111111'))).toBe('4111111111111111');
  });

  it('does not contain the plain text in the encrypted value', () => {
    expect(createService().encrypt('4111111111111111')).not.toContain('4111111111111111');
  });

  it('produces different ciphertext for the same text', () => {
    const service = createService();
    expect(service.encrypt('same text')).not.toBe(service.encrypt('same text'));
  });

  it('rejects a value without an initialization vector', () => {
    expect(() => createService().decrypt('no-separator')).toThrow('Invalid encrypted format');
  });
});

describe('validateDecryption', () => {
  it('accepts a value it encrypted', () => {
    const service = createService();
    expect(service.validateDecryption(service.encrypt('value'))).toBe(true);
  });

  it('rejects a malformed value', () => {
    expect(createService().validateDecryption('garbage')).toBe(false);
  });
});

describe('obfuscateText masks', () => {
  it.each([
    ['credit_card', '4111111111111111', '[CARD-****1111]'],
    ['ssn', '123-45-6789', '[SSN-XXX-XX-XXXX]'],
    ['api_key', 'AKIAIOSFODNN7EXAMPLE', '[KEY-AKIA...MPLE]'],
    ['password', 'hunter2hunter2', '[PASSWORD-REDACTED]'],
    ['email', 'jane@example.com', '[EMAIL-j***@example.com]'],
    ['phone', '555-123-4567', '[PHONE-****4567]'],
    ['ip_address', '8.8.4.4', '[IP-8.XXX.XXX.4]'],
    ['custom', 'anything', '[DATA-REDACTED]'],
  ])('%s values', (type, value, expectedMask) => {
    const { obfuscated } = createService().obfuscateText(value, [{ match: value, index: 0, type }]);
    expect(obfuscated).toBe(expectedMask);
  });

  it('short api keys are fully redacted', () => {
    const { obfuscated } = createService().obfuscateText('abc', [{ match: 'abc', index: 0, type: 'api_key' }]);
    expect(obfuscated).toBe('[KEY-REDACTED]');
  });
});

describe('obfuscateText', () => {
  it('replaces a match in place and stores its encrypted original', () => {
    const service = createService();
    const { obfuscated, mappings } = service.obfuscateText('Card 4111111111111111 end', [
      { match: '4111111111111111', index: 5, type: 'credit_card' },
    ]);

    expect(obfuscated).toBe('Card [CARD-****1111] end');
    expect(service.decrypt(mappings.get('[CARD-****1111]') as string)).toBe('4111111111111111');
  });

  it('replaces several matches without shifting later indexes', () => {
    const { obfuscated } = createService().obfuscateText('x 123-45-6789 y 4111111111111111', [
      { match: '123-45-6789', index: 2, type: 'ssn' },
      { match: '4111111111111111', index: 16, type: 'credit_card' },
    ]);

    expect(obfuscated).toBe('x [SSN-XXX-XX-XXXX] y [CARD-****1111]');
  });

  it('returns the text unchanged when there are no matches', () => {
    const { obfuscated, mappings } = createService().obfuscateText('nothing here', []);
    expect(obfuscated).toBe('nothing here');
    expect(mappings.size).toBe(0);
  });
});

describe('restoreObfuscatedText', () => {
  it('puts the original values back', () => {
    const service = createService();
    const original = 'Card 4111111111111111 end';
    const { obfuscated, mappings } = service.obfuscateText(original, [
      { match: '4111111111111111', index: 5, type: 'credit_card' },
    ]);

    expect(service.restoreObfuscatedText(obfuscated, mappings)).toBe(original);
  });
});

describe('createObfuscationSummary', () => {
  it('reports when nothing was detected', () => {
    expect(createService().createObfuscationSummary([])).toBe('No sensitive data detected');
  });

  it('pluralizes counts above one', () => {
    const summary = createService().createObfuscationSummary([
      { type: 'credit_card', count: 2 },
      { type: 'ssn', count: 1 },
    ]);
    expect(summary).toBe('Obfuscated: 2 credit cards, 1 SSN');
  });

  it('falls back to a generic label for unknown types', () => {
    expect(createService().createObfuscationSummary([{ type: 'mystery', count: 1 }]))
      .toBe('Obfuscated: 1 sensitive data');
  });
});
