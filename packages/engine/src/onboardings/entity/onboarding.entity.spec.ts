import { getMetadataArgsStorage, ValueTransformer } from 'typeorm';
import { AesGcmEncryptionService } from '../../encryption/aes-gcm-encryption.service';
import { DisabledEncryptionService } from '../../encryption/disabled-encryption.service';
import { setEncryptionPort } from '../../encryption/encryption.registry';
import { EncryptionKeyRing } from '../../encryption/encryption-key-ring.service';
import { OnboardingEntity } from './onboarding.entity';

const KEY_ID = 'key-1';
const KEY = Buffer.alloc(32, 7);
const AAD = 'onboardings.context';
const representativeContext = { firstName: 'Ada', email: 'ada@example.com', country: 'GB' };

/** A single-key `EncryptionKeyRing` double, enough for this file's fixed-key scenarios. */
function fakeRing(): EncryptionKeyRing {
  return {
    activeKeyId: () => KEY_ID,
    keyFor: (keyId: string) => {
      if (keyId !== KEY_ID) {
        throw new Error(`unexpected key id in test double: ${keyId}`);
      }
      return KEY;
    },
    reload: async () => undefined,
  };
}

function getContextTransformer(): ValueTransformer {
  const column = getMetadataArgsStorage().columns.find(
    (candidate) => candidate.target === OnboardingEntity && candidate.propertyName === 'context',
  );
  const transformer = column?.options.transformer;

  if (!transformer || Array.isArray(transformer)) {
    throw new Error('OnboardingEntity "context" column does not declare a single transformer');
  }

  return transformer;
}

describe('OnboardingEntity — context column', () => {
  it('declares a transformer on the context column', () => {
    expect(getContextTransformer()).toBeDefined();
  });

  it('binds the transformer to the onboardings.context AAD', () => {
    const port = new AesGcmEncryptionService(fakeRing());
    setEncryptionPort(port);
    const transformer = getContextTransformer();

    const stored = transformer.to(representativeContext) as { d: string; k: string };

    expect(() => port.decrypt(stored.d, 'connectors.settings', stored.k)).toThrow();
    expect(JSON.parse(port.decrypt(stored.d, AAD, stored.k))).toEqual(representativeContext);
  });

  it('round-trips a representative context object through to/from when encryption is enabled', () => {
    setEncryptionPort(new AesGcmEncryptionService(fakeRing()));
    const transformer = getContextTransformer();

    const stored = transformer.to(representativeContext);
    expect(stored).not.toEqual(representativeContext);

    expect(transformer.from(stored)).toEqual(representativeContext);
  });

  it('passes the context object through unchanged when encryption is disabled', () => {
    setEncryptionPort(new DisabledEncryptionService());
    const transformer = getContextTransformer();

    const stored = transformer.to(representativeContext);
    expect(stored).toBe(representativeContext);

    expect(transformer.from(stored)).toBe(representativeContext);
  });
});
