import { UnconfiguredEncryptionService } from './unconfigured-encryption.service';
import { EncryptionFailedError } from './errors/encryption-failed.error';

describe('UnconfiguredEncryptionService', () => {
  let service: UnconfiguredEncryptionService;

  beforeEach(() => {
    service = new UnconfiguredEncryptionService();
  });

  it('is never enabled', () => {
    expect(service.enabled).toBe(false);
  });

  it('encrypt throws rather than returning plaintext', () => {
    expect(() => service.encrypt('plaintext', 'onboardings.context')).toThrow(
      EncryptionFailedError,
    );
  });

  it('decrypt throws a named error pointing at the missing key-encryption key', () => {
    expect(() => service.decrypt('payload', 'onboardings.context', 'some-key-id')).toThrow(
      /no ENCRYPTION_KEY configured/,
    );
    expect(() => service.decrypt('payload', 'onboardings.context', 'some-key-id')).toThrow(
      EncryptionFailedError,
    );
  });
});
