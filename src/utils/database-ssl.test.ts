import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildDatabaseSsl } from './database-ssl';

jest.mock('./logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('buildDatabaseSsl', () => {
  const originalEnvironment = process.env;
  let certificateDirectory: string;

  beforeEach(() => {
    process.env = { ...originalEnvironment };
    delete process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
    delete process.env.DATABASE_SSL_CA;
    delete process.env.DATABASE_SSL_CA_FILE;
    certificateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'database-ssl-test-'));
  });

  afterEach(() => {
    process.env = originalEnvironment;
    fs.rmSync(certificateDirectory, { recursive: true, force: true });
  });

  it('disables TLS outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(buildDatabaseSsl()).toBe(false);
  });

  it('verifies certificates by default in production', () => {
    process.env.NODE_ENV = 'production';
    expect(buildDatabaseSsl()).toEqual({ rejectUnauthorized: true });
  });

  it('skips verification only when explicitly set to false', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = 'false';
    expect(buildDatabaseSsl()).toEqual({ rejectUnauthorized: false });
  });

  it.each(['true', 'TRUE', '0', ''])('keeps verification on for the value "%s"', value => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = value;
    expect(buildDatabaseSsl()).toEqual({ rejectUnauthorized: true });
  });

  it('trusts the certificate authority read from DATABASE_SSL_CA_FILE', () => {
    const certificatePath = path.join(certificateDirectory, 'ca.pem');
    fs.writeFileSync(certificatePath, 'certificate-authority-pem\n');
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_SSL_CA_FILE = certificatePath;

    expect(buildDatabaseSsl()).toEqual({ rejectUnauthorized: true, ca: 'certificate-authority-pem' });
  });

  it('trusts the certificate authority given inline in DATABASE_SSL_CA', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_SSL_CA = 'inline-certificate-authority-pem';

    expect(buildDatabaseSsl()).toEqual({ rejectUnauthorized: true, ca: 'inline-certificate-authority-pem' });
  });

  it('combines a certificate authority with disabled verification', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = 'false';
    process.env.DATABASE_SSL_CA = 'inline-certificate-authority-pem';

    expect(buildDatabaseSsl()).toEqual({ rejectUnauthorized: false, ca: 'inline-certificate-authority-pem' });
  });
});
