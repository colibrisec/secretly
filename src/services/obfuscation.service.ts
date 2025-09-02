import * as CryptoJS from 'crypto-js';
import { randomBytes } from 'crypto';

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

export class ObfuscationService {
  private encryptionKey: string;

  constructor(encryptionKey: string) {
    if (!encryptionKey || encryptionKey.length < 32) {
      throw new Error('Encryption key must be at least 32 characters long');
    }
    this.encryptionKey = encryptionKey;
  }

  generateId(): string {
    return randomBytes(16).toString('hex');
  }

  encrypt(text: string): string {
    const iv = CryptoJS.lib.WordArray.random(16);
    const encrypted = CryptoJS.AES.encrypt(text, this.encryptionKey, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    
    return iv.toString() + ':' + encrypted.toString();
  }

  decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted format');
    }

    const iv = CryptoJS.enc.Hex.parse(parts[0]);
    const ciphertext = parts[1];

    const decrypted = CryptoJS.AES.decrypt(ciphertext, this.encryptionKey, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });

    return decrypted.toString(CryptoJS.enc.Utf8);
  }

  obfuscateText(
    text: string,
    matches: Array<{ match: string; index: number; type: string }>
  ): { obfuscated: string; mappings: Map<string, string> } {
    let obfuscatedText = text;
    const mappings = new Map<string, string>();
    
    const sortedMatches = [...matches].sort((a, b) => b.index - a.index);

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