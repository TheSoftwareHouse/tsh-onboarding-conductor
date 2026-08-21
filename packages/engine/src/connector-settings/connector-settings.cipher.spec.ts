import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/app.config';
import { ConnectorSettingsCipher } from './connector-settings.cipher';

const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');

const createCipher = (key?: string) =>
  new ConnectorSettingsCipher({
    get: jest.fn(() => key),
  } as unknown as ConfigService<AppConfig, true>);

describe('ConnectorSettingsCipher', () => {
  it('round-trips a secret and keeps the stored form recognisable as encrypted', () => {
    const cipher = createCipher(KEY);

    const stored = cipher.encrypt('SG.super-secret');

    expect(stored.startsWith('enc.v1.')).toBe(true);
    expect(stored).not.toContain('super-secret');
    expect(cipher.isEncrypted(stored)).toBe(true);
    expect(cipher.decrypt(stored)).toBe('SG.super-secret');
  });

  it('encrypts the same value differently every time, so equal secrets are not recognisable', () => {
    const cipher = createCipher(KEY);

    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('passes a value that was never encrypted through untouched', () => {
    const cipher = createCipher(KEY);

    expect(cipher.isEncrypted('mailhog')).toBe(false);
    expect(cipher.decrypt('mailhog')).toBe('mailhog');
  });

  it('reports itself unavailable and refuses to encrypt without a configured key', () => {
    const cipher = createCipher(undefined);

    expect(cipher.available).toBe(false);
    expect(() => cipher.encrypt('SG.super-secret')).toThrow(
      'CONNECTOR_SETTINGS_ENCRYPTION_KEY is not configured',
    );
  });

  it('refuses a stored secret it cannot authenticate: another key, or an edited value', () => {
    const stored = createCipher(KEY).encrypt('SG.super-secret');

    expect(() => createCipher(OTHER_KEY).decrypt(stored)).toThrow();
    expect(() => createCipher(undefined).decrypt(stored)).toThrow();
    expect(() => createCipher(KEY).decrypt(`${stored}00`)).toThrow();
  });
});
