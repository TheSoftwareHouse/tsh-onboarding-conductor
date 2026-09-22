import { EncryptionKeyRing } from './encryption-key-ring.service';
import { EncryptionKeyNotFoundError } from './errors/encryption-key-not-found.error';
import { AesGcmEncryptionService } from './aes-gcm-encryption.service';
import { EncryptionFailedError } from './errors/encryption-failed.error';

const AAD = 'onboardings.context';

/**
 * A minimal in-memory `EncryptionKeyRing` double: enough to exercise `activeKeyId`/`keyFor`
 * without a database, and enough to simulate a rotation (`activate`) mid-test.
 */
class FakeKeyRing implements EncryptionKeyRing {
  private readonly keys = new Map<string, Buffer>();
  private active: string | null;

  constructor(initialId: string, initialKey: Buffer) {
    this.keys.set(initialId, initialKey);
    this.active = initialId;
  }

  addKey(id: string, key: Buffer): void {
    this.keys.set(id, key);
  }

  activate(id: string): void {
    this.active = id;
  }

  /** Models encryption being turned off: every key stays readable, none is written with. */
  deactivate(): void {
    this.active = null;
  }

  activeKeyId(): string | null {
    return this.active;
  }

  keyFor(keyId: string): Buffer {
    const key = this.keys.get(keyId);

    if (!key) {
      throw new EncryptionKeyNotFoundError(keyId);
    }

    return key;
  }

  async reload(): Promise<void> {
    // no-op: this double has no backing store to reload from
  }
}

describe('AesGcmEncryptionService', () => {
  const KEY_A_ID = 'key-a';
  const KEY_A = Buffer.alloc(32, 7);
  let ring: FakeKeyRing;
  let service: AesGcmEncryptionService;

  beforeEach(() => {
    ring = new FakeKeyRing(KEY_A_ID, KEY_A);
    service = new AesGcmEncryptionService(ring);
  });

  it('is enabled exactly while the ring has an active key, re-read on every access', () => {
    expect(service.enabled).toBe(true);

    ring.deactivate();
    expect(service.enabled).toBe(false);

    ring.activate(KEY_A_ID);
    expect(service.enabled).toBe(true);
  });

  /** The happy path: every test below has an active key, so `null` here is a test failure. */
  const encryptOrFail = (plaintext: string, aad: string) => {
    const encrypted = service.encryptIfEnabled(plaintext, aad);

    if (encrypted === null) {
      throw new Error('expected a key to be active');
    }

    return encrypted;
  };

  it('answers null while no key is active, rather than picking one or throwing', () => {
    ring.deactivate();

    // Never a throw: the caller has already decided it wants encryption if any is active, and a
    // key retiring since it asked is a reason to store plain JSON, not to fail a live write.
    expect(service.encryptIfEnabled('some value', AAD)).toBeNull();
  });

  it('resolves the active key exactly once, so a key retiring mid-write cannot fail it', () => {
    const activeKeyId = jest.spyOn(ring, 'activeKeyId');

    expect(service.encryptIfEnabled('some value', AAD)).not.toBeNull();
    expect(activeKeyId).toHaveBeenCalledTimes(1);
  });

  it('still decrypts a value written under a key after encryption has been turned off', () => {
    const { payload, keyId } = encryptOrFail('written while on', AAD);

    ring.deactivate();

    expect(service.decrypt(payload, AAD, keyId)).toBe('written while on');
  });

  it.each([
    ['ASCII', 'a plain ascii value'],
    ['multi-byte UTF-8', 'héllo wörld 🎉 日本語'],
    ['a 100 kB string', 'x'.repeat(100 * 1024)],
  ])('round-trips %s', (_label, plaintext) => {
    const { payload, keyId } = encryptOrFail(plaintext, AAD);

    expect(service.decrypt(payload, AAD, keyId)).toBe(plaintext);
  });

  it("encrypts with the ring's active key id", () => {
    const { keyId } = encryptOrFail('some value', AAD);

    expect(keyId).toBe(KEY_A_ID);
  });

  it('produces different payloads for identical input, both decrypting correctly', () => {
    const plaintext = 'identical input';

    const first = encryptOrFail(plaintext, AAD);
    const second = encryptOrFail(plaintext, AAD);

    expect(first.payload).not.toBe(second.payload);
    expect(service.decrypt(first.payload, AAD, first.keyId)).toBe(plaintext);
    expect(service.decrypt(second.payload, AAD, second.keyId)).toBe(plaintext);
  });

  it('throws when the payload is truncated', () => {
    const { payload, keyId } = encryptOrFail('some value', AAD);
    const truncated = Buffer.from(payload, 'base64').subarray(0, 10).toString('base64');

    expect(() => service.decrypt(truncated, AAD, keyId)).toThrow(EncryptionFailedError);
  });

  it('throws when a byte of the ciphertext is flipped', () => {
    const { payload, keyId } = encryptOrFail('some value', AAD);
    const raw = Buffer.from(payload, 'base64');
    raw[raw.length - 1] ^= 0xff;

    expect(() => service.decrypt(raw.toString('base64'), AAD, keyId)).toThrow(
      EncryptionFailedError,
    );
  });

  it('throws when the AAD differs from the one used to encrypt', () => {
    const { payload, keyId } = encryptOrFail('some value', AAD);

    expect(() => service.decrypt(payload, 'some.other.column', keyId)).toThrow(
      EncryptionFailedError,
    );
  });

  it('decrypts a value written under a previous key after a different key becomes active', () => {
    const { payload, keyId } = encryptOrFail('written under key A', AAD);

    const keyBId = 'key-b';
    ring.addKey(keyBId, Buffer.alloc(32, 9));
    ring.activate(keyBId);

    expect(encryptOrFail('written under key B', AAD).keyId).toBe(keyBId);
    expect(service.decrypt(payload, AAD, keyId)).toBe('written under key A');
  });

  it("surfaces the ring's own named error for an unknown key id, not a generic crypto failure", () => {
    expect(() => service.decrypt('irrelevant-payload', AAD, 'unknown-key')).toThrow(
      EncryptionKeyNotFoundError,
    );
  });
});
