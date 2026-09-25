import { isEncryptionKeyConfigured, parseEncryptionKey } from './encryption.config';

describe('parseEncryptionKey', () => {
  it('returns a 32-byte Buffer for a valid base64 key', () => {
    const key = Buffer.alloc(32, 7).toString('base64');

    const decoded = parseEncryptionKey(key);

    expect(decoded).toBeInstanceOf(Buffer);
    expect(decoded.length).toBe(32);
    expect(decoded.equals(Buffer.alloc(32, 7))).toBe(true);
  });

  it('rejects an undefined key', () => {
    expect(() => parseEncryptionKey(undefined)).toThrow('ENCRYPTION_KEY is not configured');
  });

  it('rejects an empty key', () => {
    expect(() => parseEncryptionKey('')).toThrow('ENCRYPTION_KEY is not configured');
    expect(() => parseEncryptionKey('   ')).toThrow('ENCRYPTION_KEY is not configured');
  });

  it('rejects a non-base64 key', () => {
    expect(() => parseEncryptionKey('not-valid-base64!!')).toThrow(
      'ENCRYPTION_KEY must be valid base64',
    );
  });

  it('rejects a key shorter than 32 bytes', () => {
    const shortKey = Buffer.alloc(16, 1).toString('base64');

    expect(() => parseEncryptionKey(shortKey)).toThrow(
      'ENCRYPTION_KEY must decode to exactly 32 bytes (got 16)',
    );
  });

  it('rejects a key longer than 32 bytes', () => {
    const longKey = Buffer.alloc(64, 1).toString('base64');

    expect(() => parseEncryptionKey(longKey)).toThrow(
      'ENCRYPTION_KEY must decode to exactly 32 bytes (got 64)',
    );
  });

  it('trims surrounding whitespace before decoding', () => {
    const key = Buffer.alloc(32, 9).toString('base64');

    const decoded = parseEncryptionKey(`  ${key}  `);

    expect(decoded.equals(Buffer.alloc(32, 9))).toBe(true);
  });
});

describe('isEncryptionKeyConfigured', () => {
  it('is false for an absent, empty or whitespace-only value', () => {
    expect(isEncryptionKeyConfigured(undefined)).toBe(false);
    expect(isEncryptionKeyConfigured('')).toBe(false);
    expect(isEncryptionKeyConfigured('   ')).toBe(false);
  });

  it('is true for any non-blank value, without judging its validity', () => {
    expect(isEncryptionKeyConfigured(Buffer.alloc(32, 7).toString('base64'))).toBe(true);
    expect(isEncryptionKeyConfigured('not-a-valid-key')).toBe(true);
  });
});
