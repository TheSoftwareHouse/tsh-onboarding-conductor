import { resolveVeriffCredentials, VERIFF_KYC_SETTINGS_SCHEMA } from './veriff-config';

const reader = (values: Record<string, string>) => ({ get: (key: string) => values[key] });

describe('VERIFF_KYC_SETTINGS_SCHEMA', () => {
  it('declares a plain required apiKey and a secret required sharedSecretKey', () => {
    expect(VERIFF_KYC_SETTINGS_SCHEMA.fields).toEqual([
      { key: 'apiKey', secret: false, required: true },
      { key: 'sharedSecretKey', secret: true, required: true },
    ]);
  });
});

describe('resolveVeriffCredentials', () => {
  it('returns the api key and the single secret', () => {
    expect(resolveVeriffCredentials(reader({ apiKey: 'key-1', sharedSecretKey: 's1' }))).toEqual({
      apiKey: 'key-1',
      sharedSecretKey: 's1',
    });
  });

  it('takes the first rotation entry, trimmed', () => {
    expect(
      resolveVeriffCredentials(reader({ apiKey: 'key-1', sharedSecretKey: ' new , old' })),
    ).toEqual({ apiKey: 'key-1', sharedSecretKey: 'new' });
  });
});
