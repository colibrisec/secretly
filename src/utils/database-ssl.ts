import { ConnectionOptions } from 'tls';
import { getSecret } from './secrets';

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
