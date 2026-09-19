import fs from 'fs';
import os from 'os';
import path from 'path';
import { getRequiredSecret, getSecret, validateRequiredSecrets } from './secrets';

jest.mock('./logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('secrets', () => {
  const originalEnvironment = process.env;
  let secretsDirectory: string;

  beforeEach(() => {
    process.env = { ...originalEnvironment };
    delete process.env.TEST_SECRET;
    delete process.env.TEST_SECRET_FILE;
    secretsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-test-'));
  });

  afterEach(() => {
    process.env = originalEnvironment;
    fs.rmSync(secretsDirectory, { recursive: true, force: true });
  });

  function writeSecretFile(content: string): string {
    const filePath = path.join(secretsDirectory, 'secret');
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  describe('getSecret', () => {
    it('reads the secret from the file named by the _FILE variable and trims it', () => {
      process.env.TEST_SECRET_FILE = writeSecretFile('from-file\n');
      expect(getSecret('TEST_SECRET')).toBe('from-file');
    });

    it('prefers the file over the environment variable', () => {
      process.env.TEST_SECRET_FILE = writeSecretFile('from-file');
      process.env.TEST_SECRET = 'from-environment';
      expect(getSecret('TEST_SECRET')).toBe('from-file');
    });

    it('falls back to the environment variable when the file does not exist', () => {
      process.env.TEST_SECRET_FILE = path.join(secretsDirectory, 'missing');
      process.env.TEST_SECRET = 'from-environment';
      expect(getSecret('TEST_SECRET')).toBe('from-environment');
    });

    it('falls back to the environment variable when the file is empty', () => {
      process.env.TEST_SECRET_FILE = writeSecretFile('   \n');
      process.env.TEST_SECRET = 'from-environment';
      expect(getSecret('TEST_SECRET')).toBe('from-environment');
    });

    it('returns undefined when neither source is set', () => {
      expect(getSecret('TEST_SECRET')).toBeUndefined();
    });
  });

  describe('getRequiredSecret', () => {
    it('returns the secret when present', () => {
      process.env.TEST_SECRET = 'present';
      expect(getRequiredSecret('TEST_SECRET')).toBe('present');
    });

    it('throws when the secret is missing', () => {
      expect(() => getRequiredSecret('TEST_SECRET')).toThrow('Required secret TEST_SECRET not found');
    });
  });

  describe('validateRequiredSecrets', () => {
    it('passes when every secret is available', () => {
      process.env.TEST_SECRET = 'present';
      expect(() => validateRequiredSecrets(['TEST_SECRET'])).not.toThrow();
    });

    it('lists every missing secret in the error', () => {
      process.env.TEST_SECRET = 'present';
      expect(() => validateRequiredSecrets(['TEST_SECRET', 'MISSING_ONE', 'MISSING_TWO']))
        .toThrow('Missing required secrets: MISSING_ONE, MISSING_TWO');
    });
  });
});
