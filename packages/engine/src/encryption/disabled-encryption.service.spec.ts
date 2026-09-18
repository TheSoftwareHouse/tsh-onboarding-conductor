import { DisabledEncryptionService } from './disabled-encryption.service';
import { EncryptionFailedError } from './errors/encryption-failed.error';

describe('DisabledEncryptionService', () => {
  let service: DisabledEncryptionService;

  beforeEach(() => {
    service = new DisabledEncryptionService();
  });

  it('is disabled', () => {
    expect(service.enabled).toBe(false);
  });

  it('encrypt throws', () => {
    expect(() => service.encrypt('plaintext', 'onboardings.context')).toThrow(
      EncryptionFailedError,
    );
  });

  it('decrypt throws a named error mentioning that encryption is disabled', () => {
    expect(() => service.decrypt('payload', 'onboardings.context', 'some-key-id')).toThrow(
      /ENCRYPTION_ENABLED=false/,
    );
    expect(() => service.decrypt('payload', 'onboardings.context', 'some-key-id')).toThrow(
      EncryptionFailedError,
    );
  });
});
