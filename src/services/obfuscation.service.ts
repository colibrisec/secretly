import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'crypto';

export interface ObfuscationRecord {
  id: string;
  messageTs: string;
  channelId: string;
  userId: string;
  originalContent: string;
  obfuscatedContent: string;
  detectionType: string;
  severity: string;
  createdAt: Date;
  dismissedAt?: Date;
  dismissedBy?: string;
}

const V2_PREFIX = 'v2:';
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

export class ObfuscationService {
  private encryptionKey: string;
  private gcmKey: Buffer;

  constructor(encryptionKey: string) {
    if (!encryptionKey || encryptionKey.length < 32) {
      throw new Error('Encryption key must be at least 32 characters long');
    }
    this.encryptionKey = encryptionKey;
    this.gcmKey = Buffer.from(
      hkdfSync('sha256', Buffer.from(encryptionKey, 'utf8'), Buffer.alloc(0), 'secretly/obfuscation/aes-256-gcm/v2', 32)
    );
  }

  generateId(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * AES-256-GCM. Output: "v2:" + base64(iv | auth tag | ciphertext).
   */
  encrypt(text: string): string {
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.gcmKey, iv);
    const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return V2_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }

  decrypt(encryptedText: string): string {
    if (encryptedText.startsWith(V2_PREFIX)) {
      return this.decryptV2(encryptedText.slice(V2_PREFIX.length));
    }
    return this.decryptLegacy(encryptedText);
  }

  private decryptV2(payload: string): string {
    const data = Buffer.from(payload, 'base64');
    if (data.length < GCM_IV_BYTES + GCM_TAG_BYTES) {
      throw new Error('Invalid encrypted format');
    }
    const iv = data.subarray(0, GCM_IV_BYTES);
    const tag = data.subarray(GCM_IV_BYTES, GCM_IV_BYTES + GCM_TAG_BYTES);
    const ciphertext = data.subarray(GCM_IV_BYTES + GCM_TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.gcmKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /**
   * Reads records written by the old crypto-js code: "<hex iv>:<OpenSSL
   * salted base64>". crypto-js treated the key as a passphrase, so the hex
   * IV was ignored and the real key/IV came from EVP_BytesToKey (MD5) with
   * the embedded salt. Decrypt-only; new data is always v2.
   */
  private decryptLegacy(encryptedText: string): string {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted format');
    }
    const data = Buffer.from(parts[1], 'base64');
    if (data.length < 16 || data.subarray(0, 8).toString('latin1') !== 'Salted__') {
      throw new Error('Invalid encrypted format');
    }
    const salt = data.subarray(8, 16);
    const ciphertext = data.subarray(16);

    const password = Buffer.from(this.encryptionKey, 'utf8');
    const blocks: Buffer[] = [];
    let prev = Buffer.alloc(0);
    while (Buffer.concat(blocks).length < 48) {
      prev = createHash('md5').update(Buffer.concat([prev, password, salt])).digest();
      blocks.push(prev);
    }
    const derived = Buffer.concat(blocks);
    const decipher = createDecipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32, 48));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  obfuscateText(
    text: string,
    matches: Array<{ match: string; index: number; type: string }>
  ): { obfuscated: string; mappings: Map<string, string> } {
    let obfuscatedText = text;
    const mappings = new Map<string, string>();
    
    // Overlapping matches (e.g. an API key that is also high entropy) would
    // splice against shifted offsets and garble the text, so keep the first
    // (longest at a given start) and drop anything overlapping it.
    const nonOverlapping: typeof matches = [];
    let lastEnd = -1;
    for (const m of [...matches].sort((a, b) => a.index - b.index || b.match.length - a.match.length)) {
      if (m.index >= lastEnd) {
        nonOverlapping.push(m);
        lastEnd = m.index + m.match.length;
      }
    }
    const sortedMatches = nonOverlapping.reverse();

    for (const { match, index, type } of sortedMatches) {
      const mask = this.createMask(match, type);
      const encryptedValue = this.encrypt(match);
      
      mappings.set(mask, encryptedValue);
      
      obfuscatedText = 
        obfuscatedText.slice(0, index) + 
        mask + 
        obfuscatedText.slice(index + match.length);
    }

    return { obfuscated: obfuscatedText, mappings };
  }

  private createMask(value: string, type: string): string {
    switch (type) {
    case 'credit_card': {
      const digits = value.replace(/\D/g, '');
      if (digits.length >= 4) {
        return `[CARD-****${digits.slice(-4)}]`;
      }
      return '[CARD-REDACTED]';
    }
      
    case 'ssn':
      return '[SSN-XXX-XX-XXXX]';
      
    case 'api_key':
      if (value.length > 8) {
        return `[KEY-${value.slice(0, 4)}...${value.slice(-4)}]`;
      }
      return '[KEY-REDACTED]';
      
    case 'password':
      return '[PASSWORD-REDACTED]';
      
    case 'email': {
      const emailParts = value.split('@');
      if (emailParts.length === 2) {
        const username = emailParts[0];
        const domain = emailParts[1];
        const maskedUsername = username.charAt(0) + '*'.repeat(username.length - 1);
        return `[EMAIL-${maskedUsername}@${domain}]`;
      }
      return '[EMAIL-REDACTED]';
    }
      
    case 'phone': {
      const phoneDigits = value.replace(/\D/g, '');
      if (phoneDigits.length >= 4) {
        return `[PHONE-****${phoneDigits.slice(-4)}]`;
      }
      return '[PHONE-REDACTED]';
    }
      
    case 'ip_address': {
      const parts = value.split('.');
      if (parts.length === 4) {
        return `[IP-${parts[0]}.XXX.XXX.${parts[3]}]`;
      }
      return '[IP-REDACTED]';
    }
      
    default:
      return '[DATA-REDACTED]';
    }
  }

  restoreObfuscatedText(
    obfuscatedText: string,
    mappings: Map<string, string>
  ): string {
    let restoredText = obfuscatedText;

    for (const [mask, encryptedValue] of mappings.entries()) {
      const originalValue = this.decrypt(encryptedValue);
      restoredText = restoredText.replace(mask, originalValue);
    }

    return restoredText;
  }

  createObfuscationSummary(
    detections: Array<{ type: string; count: number }>
  ): string {
    if (detections.length === 0) {
      return 'No sensitive data detected';
    }

    const summaryParts = detections.map(({ type, count }) => {
      const typeLabel = this.getTypeLabel(type);
      return `${count} ${typeLabel}${count > 1 ? 's' : ''}`;
    });

    return `Obfuscated: ${summaryParts.join(', ')}`;
  }

  private getTypeLabel(type: string): string {
    const labels: { [key: string]: string } = {
      credit_card: 'credit card',
      ssn: 'SSN',
      api_key: 'API key',
      password: 'password',
      email: 'email address',
      phone: 'phone number',
      ip_address: 'IP address',
      custom: 'sensitive item'
    };
    return labels[type] || 'sensitive data';
  }

  validateDecryption(encryptedText: string): boolean {
    try {
      this.decrypt(encryptedText);
      return true;
    } catch {
      return false;
    }
  }
}