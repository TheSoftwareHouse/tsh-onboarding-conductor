import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/app.config';

const ALGORITHM = 'aes-256-gcm';
const INITIALIZATION_VECTOR_BYTES = 12;
/** Marks a stored value as encrypted, and which recipe encrypted it. */
const ENCRYPTED_VALUE_PREFIX = 'enc.v1.';
const ENCRYPTED_VALUE_PART_COUNT = 3;

/**
 * Encrypts the setting values declared secret. AES-256-GCM authenticates as well as encrypts, so
 * a value edited directly in the database fails to decrypt rather than reaching a provider.
 *
 * The stored form is self-describing (`enc.v1.<iv>.<tag>.<ciphertext>`, base64), which is what
 * lets one column hold both a plaintext host name and an encrypted API key.
 */
@Injectable()
export class ConnectorSettingsCipher {
  private readonly key?: Buffer;

  constructor(configService: ConfigService<AppConfig, true>) {
    const configuredKey = configService.get<string>('CONNECTOR_SETTINGS_ENCRYPTION_KEY');
    this.key = configuredKey ? Buffer.from(configuredKey, 'base64') : undefined;
  }

  /** Whether secrets can be stored at all; configuration validation has already checked length. */
  get available(): boolean {
    return this.key !== undefined;
  }

  encrypt(value: string): string {
    if (!this.key) {
      throw new Error('CONNECTOR_SETTINGS_ENCRYPTION_KEY is not configured');
    }

    const initializationVector = randomBytes(INITIALIZATION_VECTOR_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, initializationVector);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

    const encodedParts = [
      initializationVector.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');

    return `${ENCRYPTED_VALUE_PREFIX}${encodedParts}`;
  }

  /** Returns a value written before it was declared secret unchanged; only encrypted ones decrypt. */
  decrypt(storedValue: string): string {
    if (!this.isEncrypted(storedValue)) {
      return storedValue;
    }

    const parts = storedValue.slice(ENCRYPTED_VALUE_PREFIX.length).split('.');

    if (parts.length !== ENCRYPTED_VALUE_PART_COUNT || !this.key) {
      throw new Error('Stored value cannot be decrypted');
    }

    const [initializationVector, authTag, ciphertext] = parts;
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(initializationVector, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  isEncrypted(storedValue: string): boolean {
    return storedValue.startsWith(ENCRYPTED_VALUE_PREFIX);
  }
}
