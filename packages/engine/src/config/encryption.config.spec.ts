import { parseEncryptionKey } from './encryption.config';

describe('parseEncryptionKey', () => {
  it('returns a 32-byte Buffer for a valid base64 key', () => {
    const key = Buffer.alloc(32, 7).toString('base64');

    const decoded = parseEncryptionKey(key);

    expect(decoded).toBeInstanceOf(Buffer);
    expect(decoded.length).toBe(32);
    expect(decoded.equals(Buffer.alloc(32, 7))).toBe(true);
  });

  it('rejects an undefined key', () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(
      'ENCRYPTION_KEY is required when ENCRYPTION_ENABLED=true',
    );
  });

  it('rejects an empty key', () => {
    expect(() => parseEncryptionKey('')).toThrow(
      'ENCRYPTION_KEY is required when ENCRYPTION_ENABLED=true',
    );
    expect(() => parseEncryptionKey('   ')).toThrow(
      'ENCRYPTION_KEY is required when ENCRYPTION_ENABLED=true',
    );
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
