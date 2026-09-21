/**
 * Thrown at boot when `encryption_keys` already holds keys but this process has no key-encryption
 * key (`ENCRYPTION_KEY`) to unwrap them with. Every onboarding those keys protect would be
 * unreadable, so the engine refuses to start and names the fix rather than serving `500`s on
 * every read. Never carries material — there is none to carry.
 */
export class EncryptionKeyNotConfiguredError extends Error {
  constructor(keyCount: number) {
    super(
      `encryption_keys holds ${keyCount} key(s) but ENCRYPTION_KEY is not configured; the data ` +
        'they protect cannot be read without it — configure the key-encryption key this ' +
        'deployment was using and restart',
    );
    this.name = 'EncryptionKeyNotConfiguredError';
  }
}
