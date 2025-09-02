export interface DetectionPattern {
  name: string;
  pattern: RegExp;
  type: 'credit_card' | 'ssn' | 'api_key' | 'password' | 'email' | 'phone' | 'ip_address' | 'custom';
  severity: 'low' | 'medium' | 'high' | 'critical';
  validator?: (match: string) => boolean;
  description: string;
}

export const patterns: DetectionPattern[] = [
  {
    name: 'Credit Card',
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    type: 'credit_card',
    severity: 'critical',
    validator: luhnCheck,
    description: 'Credit card number detected'
  },
  {
    name: 'US Social Security Number',
    pattern: /\b(?!000|666|9\d{2})([0-8]\d{2}|7([0-6]\d|7[0-2]))-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    type: 'ssn',
    severity: 'critical',
    description: 'Social Security Number detected'
  },
  {
    name: 'AWS Access Key',
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    type: 'api_key',
    severity: 'critical',
    description: 'AWS Access Key detected'
  },
  {
    name: 'AWS Secret Key',
    pattern: /\b([A-Za-z0-9/+=]{40})\b/g,
    type: 'api_key',
    severity: 'critical',
    validator: (match: string) => {
      return match.length === 40 && /[A-Z]/.test(match) && /[a-z]/.test(match) && /[0-9]/.test(match);
    },
    description: 'AWS Secret Key detected'
  },
  {
    name: 'GitHub Personal Access Token',
    pattern: /\b(ghp_[a-zA-Z0-9]{36})\b/g,
    type: 'api_key',
    severity: 'critical',
    description: 'GitHub Personal Access Token detected'
  },
  {
    name: 'GitHub OAuth Token',
    pattern: /\b(gho_[a-zA-Z0-9]{36})\b/g,
    type: 'api_key',
    severity: 'critical',
    description: 'GitHub OAuth Token detected'
  },
  {
    name: 'GitHub App Token',
    pattern: /\b(ghs_[a-zA-Z0-9]{36})\b/g,
    type: 'api_key',
    severity: 'critical',
    description: 'GitHub App Token detected'
  },
  {
    name: 'GitHub Refresh Token',
    pattern: /\b(ghr_[a-zA-Z0-9]{36})\b/g,
    type: 'api_key',
    severity: 'critical',
    description: 'GitHub Refresh Token detected'
  },
  {
    name: 'Slack Token',
    pattern: /\b(xox[baprs]-[a-zA-Z0-9-]+)\b/g,
    type: 'api_key',
    severity: 'critical',
    description: 'Slack Token detected'
  },
  {
    name: 'Slack Webhook',
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[a-zA-Z0-9]+/g,
    type: 'api_key',
    severity: 'high',
    description: 'Slack Webhook URL detected'
  },
  {
    name: 'Generic API Key',
    pattern: /\b(api[_-]?key|apikey|api[_-]?secret|api[_-]?token)['"\\s]*[:=]['"\\s]*([a-zA-Z0-9_-]{32,})\b/gi,
    type: 'api_key',
    severity: 'high',
    description: 'Generic API Key detected'
  },
  {
    name: 'Password in Plain Text',
    pattern: /\b(password|passwd|pwd|pass)['"\\s]*[:=]['"\\s]*([^'"\s]{8,})\b/gi,
    type: 'password',
    severity: 'critical',
    description: 'Password in plain text detected'
  },
  {
    name: 'Private Key',
    pattern: /-----BEGIN\s+(RSA|DSA|EC|OPENSSH|PGP)\s+PRIVATE\s+KEY-----/gi,
    type: 'api_key',
    severity: 'critical',
    description: 'Private key detected'
  },
  {
    name: 'Email Address',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    type: 'email',
    severity: 'low',
    description: 'Email address detected'
  },
  {
    name: 'US Phone Number',
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    type: 'phone',
    severity: 'medium',
    description: 'Phone number detected'
  },
  {
    name: 'IPv4 Address',
    pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    type: 'ip_address',
    severity: 'medium',
    validator: (match: string) => {
      const privateRanges = [
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[01])\./,
        /^192\.168\./,
        /^127\./
      ];
      return !privateRanges.some(range => range.test(match));
    },
    description: 'Public IP address detected'
  },
  {
    name: 'Database Connection String',
    pattern: /\b(mongodb|mysql|postgresql|postgres|redis):\/\/[^\s]+/gi,
    type: 'api_key',
    severity: 'critical',
    description: 'Database connection string detected'
  },
  {
    name: 'JWT Token',
    pattern: /\beyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g,
    type: 'api_key',
    severity: 'high',
    description: 'JWT token detected'
  }
];

function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '');
  
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

export function detectSensitiveData(text: string, enabledTypes?: string[]): Array<{
  pattern: DetectionPattern;
  match: string;
  index: number;
}> {
  const results: Array<{
    pattern: DetectionPattern;
    match: string;
    index: number;
  }> = [];

  for (const pattern of patterns) {
    if (enabledTypes && !enabledTypes.includes(pattern.type)) {
      continue;
    }

    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
    let match;

    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0];
      
      if (!pattern.validator || pattern.validator(matchedText)) {
        results.push({
          pattern,
          match: matchedText,
          index: match.index
        });
      }
    }
  }

  return results;
}

export function calculateEntropy(str: string): number {
  const charCounts: { [key: string]: number } = {};
  const len = str.length;

  for (const char of str) {
    charCounts[char] = (charCounts[char] || 0) + 1;
  }

  let entropy = 0;
  for (const count of Object.values(charCounts)) {
    const probability = count / len;
    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}

export function detectHighEntropyStrings(text: string, threshold: number = 4.5): string[] {
  const words = text.split(/\s+/);
  const highEntropyStrings: string[] = [];

  for (const word of words) {
    if (word.length >= 20 && calculateEntropy(word) >= threshold) {
      highEntropyStrings.push(word);
    }
  }

  return highEntropyStrings;
}