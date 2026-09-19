import { calculateEntropy, detectHighEntropyStrings, detectSensitiveData } from './patterns';

function namesDetectedIn(text: string, enabledTypes?: string[]): string[] {
  return detectSensitiveData(text, enabledTypes).map(result => result.pattern.name);
}

describe('detectSensitiveData', () => {
  it('detects a credit card number that passes the Luhn check', () => {
    expect(namesDetectedIn('card 4111 1111 1111 1111 ok')).toContain('Credit Card');
  });

  it('ignores a card-like number that fails the Luhn check', () => {
    expect(namesDetectedIn('card 4111 1111 1111 1112 ok')).not.toContain('Credit Card');
  });

  it('detects a social security number', () => {
    expect(namesDetectedIn('ssn 123-45-6789')).toContain('US Social Security Number');
  });

  it('ignores a social security number with an all-zero area', () => {
    expect(namesDetectedIn('ssn 000-12-3456')).not.toContain('US Social Security Number');
  });

  it('detects an AWS access key', () => {
    const accessKey = 'AKIA' + 'IOSFODNN7EXAMPLE';
    expect(namesDetectedIn(`key ${accessKey} here`)).toContain('AWS Access Key');
  });

  it('detects a plain text password assignment', () => {
    const assignment = ['password', 'hunter2hunter2'].join('=');
    expect(namesDetectedIn(assignment)).toContain('Password in Plain Text');
  });

  it('detects an email address', () => {
    expect(namesDetectedIn('write to jane@example.com')).toContain('Email Address');
  });

  it('flags a public IPv4 address', () => {
    expect(namesDetectedIn('host 8.8.8.8')).toContain('IPv4 Address');
  });

  it.each(['10.0.0.5', '172.16.4.2', '192.168.1.1', '127.0.0.1'])(
    'ignores the private IPv4 address %s',
    address => {
      expect(namesDetectedIn(`host ${address}`)).not.toContain('IPv4 Address');
    }
  );

  it('reports the index of each match', () => {
    const [result] = detectSensitiveData('mail jane@example.com now', ['email']);
    expect(result.index).toBe(5);
    expect(result.match).toBe('jane@example.com');
  });

  it('only returns patterns of the enabled types', () => {
    const accessKey = 'AKIA' + 'IOSFODNN7EXAMPLE';
    const results = detectSensitiveData(`${accessKey} jane@example.com`, ['email']);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(result => result.pattern.type === 'email')).toBe(true);
  });

  it('returns nothing for text without sensitive data', () => {
    expect(detectSensitiveData('just a normal sentence')).toEqual([]);
  });
});

describe('calculateEntropy', () => {
  it('is zero for a single repeated character', () => {
    expect(calculateEntropy('aaaa')).toBe(0);
  });

  it('is two bits for four equally frequent characters', () => {
    expect(calculateEntropy('abcd')).toBe(2);
  });
});

describe('detectHighEntropyStrings', () => {
  it('returns long words with high entropy', () => {
    const highEntropyWord = 'abcdefghijklmnopqrstuvwxyz0123';
    expect(detectHighEntropyStrings(`token ${highEntropyWord} end`)).toEqual([highEntropyWord]);
  });

  it('ignores long words with low entropy', () => {
    expect(detectHighEntropyStrings('a'.repeat(30))).toEqual([]);
  });

  it('ignores short words', () => {
    expect(detectHighEntropyStrings('abcdefghij')).toEqual([]);
  });
});
