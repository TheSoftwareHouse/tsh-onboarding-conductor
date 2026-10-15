import { CreditConfigInvalidError } from '../credit/credit-config';
import {
  ALGOAN_CREDIT_SETTINGS_SCHEMA,
  parseAlgoanProviderConfig,
  resolveAlgoanCredentials,
} from './algoan-config';

describe('algoan-config', () => {
  it('declares the two API credentials and the callback secret, the secrets masked', () => {
    expect(ALGOAN_CREDIT_SETTINGS_SCHEMA.fields).toEqual([
      { key: 'clientId', secret: false, required: true },
      { key: 'clientSecret', secret: true, required: true },
      { key: 'callbackSigningSecret', secret: true, required: true },
    ]);
  });

  it('resolves the API credentials from the settings', () => {
    const values: Record<string, string> = { clientId: 'id-1', clientSecret: 'secret-1' };

    expect(resolveAlgoanCredentials({ get: (key) => values[key] })).toEqual({
      clientId: 'id-1',
      clientSecret: 'secret-1',
    });
  });

  it('defaults the currency to GBP and accepts an ISO code', () => {
    expect(parseAlgoanProviderConfig({})).toEqual({ currency: 'GBP' });
    expect(parseAlgoanProviderConfig({ currency: 'EUR' })).toEqual({ currency: 'EUR' });
  });

  it.each([['gbp'], ['POUND'], [1], ['']])('refuses the currency %p', (currency) => {
    expect(() => parseAlgoanProviderConfig({ currency })).toThrow(CreditConfigInvalidError);
  });
});
