import { EncryptionKeyRing } from './encryption-key-ring.service';
import { EncryptionKeyNotFoundError } from './errors/encryption-key-not-found.error';
import { AesGcmEncryptionService } from './aes-gcm-encryption.service';
import { DisabledEncryptionService } from './disabled-encryption.service';
import {
  createEncryptedJsonTransformer,
  EncryptedJsonEnvelope,
} from './encrypted-json.transformer';
import { setEncryptionPort } from './encryption.registry';
import { EncryptionFailedError } from './errors/encryption-failed.error';

const AAD = 'onboardings.context';
const KEY_A_ID = 'key-a';
const KEY_A = Buffer.alloc(32, 3);

/** Same minimal ring double used by `aes-gcm-encryption.service.spec.ts`. */
class FakeKeyRing implements EncryptionKeyRing {
  private readonly keys = new Map<string, Buffer>();
  private active: string;

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

  activeKeyId(): string {
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

function isEnvelope(value: unknown): value is EncryptedJsonEnvelope {
  return typeof value === 'object' && value !== null && '__tsh_enc' in value;
}

describe('createEncryptedJsonTransformer', () => {
  const transformer = createEncryptedJsonTransformer(AAD);
  const representativeValue = { firstName: 'Ada', email: 'ada@example.com', country: 'GB' };

  describe('with encryption enabled', () => {
    let ring: FakeKeyRing;

    beforeEach(() => {
      ring = new FakeKeyRing(KEY_A_ID, KEY_A);
      setEncryptionPort(new AesGcmEncryptionService(ring));
    });

    it('to(null) and to(undefined) pass through untouched', () => {
      expect(transformer.to(null)).toBeNull();
      expect(transformer.to(undefined)).toBeUndefined();
    });

    it('to(value) returns an EncryptedJsonEnvelope over JSON.stringify(value), carrying the active key id', () => {
      const result = transformer.to(representativeValue);

      expect(isEnvelope(result)).toBe(true);
      const envelope = result as EncryptedJsonEnvelope;
      expect(typeof envelope.__tsh_enc).toBe('string');
      expect(envelope.k).toBe(KEY_A_ID);
      expect(typeof envelope.d).toBe('string');
    });

    it('from(envelope) decrypts and JSON.parses back to the original value', () => {
      const envelope = transformer.to(representativeValue);

      expect(transformer.from(envelope)).toEqual(representativeValue);
    });

    it('round-trips the representative context object', () => {
      const stored = transformer.to(representativeValue);
      const loaded = transformer.from(stored);

      expect(loaded).toEqual(representativeValue);
    });

    it('a value written under key A still decrypts after key B becomes the active key', () => {
      const stored = transformer.to(representativeValue) as EncryptedJsonEnvelope;
      expect(stored.k).toBe(KEY_A_ID);

      const keyBId = 'key-b';
      ring.addKey(keyBId, Buffer.alloc(32, 5));
      ring.activate(keyBId);

      // The active key moved on, but the envelope still names key A and must still decrypt.
      expect(transformer.from(stored)).toEqual(representativeValue);

      // A value written after rotation carries the new active key's id.
      const storedAfterRotation = transformer.to(representativeValue) as EncryptedJsonEnvelope;
      expect(storedAfterRotation.k).toBe(keyBId);
      expect(transformer.from(storedAfterRotation)).toEqual(representativeValue);
    });

    it('from(value) that is not an envelope passes through unchanged', () => {
      expect(transformer.from(representativeValue)).toEqual(representativeValue);
    });

    it('from(null) and from(undefined) pass through untouched', () => {
      expect(transformer.from(null)).toBeNull();
      expect(transformer.from(undefined)).toBeUndefined();
    });

    it('throws on a malformed envelope carrying a __tsh_enc key', () => {
      expect(() => transformer.from({ __tsh_enc: 'aes-256-gcm.v1' })).toThrow(
        EncryptionFailedError,
      );
    });

    it('throws a named error mentioning the column when "k" is absent', () => {
      expect(() => transformer.from({ __tsh_enc: 'aes-256-gcm.v1', d: 'irrelevant' })).toThrow(
        new RegExp(AAD),
      );
      expect(() => transformer.from({ __tsh_enc: 'aes-256-gcm.v1', d: 'irrelevant' })).toThrow(
        EncryptionFailedError,
      );
    });

    it('throws a named error mentioning the column when "k" is not a string', () => {
      expect(() =>
        transformer.from({ __tsh_enc: 'aes-256-gcm.v1', d: 'irrelevant', k: 42 }),
      ).toThrow(new RegExp(AAD));
      expect(() =>
        transformer.from({ __tsh_enc: 'aes-256-gcm.v1', d: 'irrelevant', k: 42 }),
      ).toThrow(EncryptionFailedError);
    });

    it("surfaces the ring's own named error when the envelope names an unknown key id", () => {
      const envelope: EncryptedJsonEnvelope = {
        __tsh_enc: 'aes-256-gcm.v1',
        k: 'never-issued',
        d: 'irrelevant',
      };

      expect(() => transformer.from(envelope)).toThrow(EncryptionKeyNotFoundError);
    });
  });

  describe('with encryption disabled', () => {
    beforeEach(() => {
      setEncryptionPort(new DisabledEncryptionService());
    });

    it('to(null) and to(undefined) pass through untouched', () => {
      expect(transformer.to(null)).toBeNull();
      expect(transformer.to(undefined)).toBeUndefined();
    });

    it('to(value) returns the value unchanged (plain JSON)', () => {
      expect(transformer.to(representativeValue)).toBe(representativeValue);
    });

    it('passes the representative context object through unchanged', () => {
      const stored = transformer.to(representativeValue);
      const loaded = transformer.from(stored);

      expect(loaded).toBe(representativeValue);
    });

    it('from(value) that is not an envelope passes through unchanged', () => {
      expect(transformer.from(representativeValue)).toEqual(representativeValue);
    });

    it('from(null) and from(undefined) pass through untouched', () => {
      expect(transformer.from(null)).toBeNull();
      expect(transformer.from(undefined)).toBeUndefined();
    });

    it('from(envelope) throws because a stored value is encrypted while disabled', () => {
      const envelope: EncryptedJsonEnvelope = {
        __tsh_enc: 'aes-256-gcm.v1',
        k: KEY_A_ID,
        d: 'irrelevant',
      };

      expect(() => transformer.from(envelope)).toThrow(EncryptionFailedError);
    });
  });

  describe('requireEncryptionPort', () => {
    it('throws when no port has been set', () => {
      jest.isolateModules(() => {
        // A fresh module instance is required here: the outer describe blocks already called
        // `setEncryptionPort`, and the registry is a module-level singleton with no reset export.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const registry = require('./encryption.registry');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const errors = require('./errors/encryption-unavailable.error');

        expect(() => registry.requireEncryptionPort()).toThrow(errors.EncryptionUnavailableError);
      });
    });
  });
});
