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

  it('answers null rather than throwing, however it is reached', () => {
    expect(service.encryptIfEnabled()).toBeNull();
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
