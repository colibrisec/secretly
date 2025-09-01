import fs from 'fs';
import { logger } from './logger';

/**
 * Reads a secret from either environment variable or file
 * Files take precedence over environment variables for security
 */
export function getSecret(name: string): string | undefined {
  const fileEnvName = `${name}_FILE`;
  const filePath = process.env[fileEnvName];
  
  // Try to read from file first (more secure)
  if (filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const secret = fs.readFileSync(filePath, 'utf-8').trim();
        if (secret) {
          logger.debug(`Secret ${name} loaded from file: ${filePath}`);
          return secret;
        }
      } else {
        logger.warn(`Secret file not found: ${filePath}`);
      }
    } catch (error) {
      logger.error(`Failed to read secret from file ${filePath}:`, error);
    }
  }
  
  // Fallback to environment variable
  const envValue = process.env[name];
  if (envValue) {
    logger.debug(`Secret ${name} loaded from environment variable`);
    return envValue;
  }
  
  logger.warn(`Secret ${name} not found in file or environment variable`);
  return undefined;
}

/**
 * Gets required secret or throws error if not found
 */
export function getRequiredSecret(name: string): string {
  const secret = getSecret(name);
  if (!secret) {
    throw new Error(`Required secret ${name} not found in file or environment variable`);
  }
  return secret;
}

/**
 * Validates that all required secrets are available
 */
export function validateRequiredSecrets(secretNames: string[]): void {
  const missing: string[] = [];
  
  for (const name of secretNames) {
    if (!getSecret(name)) {
      missing.push(name);
    }
  }
  
  if (missing.length > 0) {
    throw new Error(`Missing required secrets: ${missing.join(', ')}`);
  }
  
  logger.info(`All required secrets validated: ${secretNames.join(', ')}`);
}