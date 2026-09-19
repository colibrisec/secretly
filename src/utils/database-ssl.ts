import { ConnectionOptions } from 'tls';
import { getSecret } from './secrets';

const SSL_PARAMETERS = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert'];

function hasCertificateAuthority(): boolean {
  return Boolean(process.env.DATABASE_SSL_CA_FILE || process.env.DATABASE_SSL_CA);
}

export function buildDatabaseSsl(): false | ConnectionOptions {
  if (process.env.NODE_ENV !== 'production') {
    return false;
  }

  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';

  if (!hasCertificateAuthority()) {
    return { rejectUnauthorized };
  }

  return { rejectUnauthorized, ca: getSecret('DATABASE_SSL_CA') };
}

export function stripSslParameters(connectionString: string): string {
  const separatorIndex = connectionString.indexOf('?');
  if (separatorIndex === -1) {
    return connectionString;
  }

  const base = connectionString.slice(0, separatorIndex);
  const parameters = new URLSearchParams(connectionString.slice(separatorIndex + 1));
  SSL_PARAMETERS.forEach(name => parameters.delete(name));

  const remaining = parameters.toString();
  return remaining ? `${base}?${remaining}` : base;
}
