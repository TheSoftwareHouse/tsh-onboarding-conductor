import { generateUuidV7 } from './uuid.util';

describe('generateUuidV7', () => {
  it('preserves the public UUIDv7 version and RFC variant contract', () => {
    const value = generateUuidV7();

    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
