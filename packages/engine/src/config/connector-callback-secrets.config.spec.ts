import { parseConnectorCallbackSecrets } from './connector-callback-secrets.config';

describe('parseConnectorCallbackSecrets', () => {
  it('normalizes a single secret into a one-entry list', () => {
    expect(parseConnectorCallbackSecrets('{"tsh_kyc":"signing-value"}')).toEqual({
      tsh_kyc: ['signing-value'],
    });
  });

  it('keeps a rotation list in declaration order', () => {
    expect(parseConnectorCallbackSecrets('{"tsh_kyc":["current-value","previous-value"]}')).toEqual(
      {
        tsh_kyc: ['current-value', 'previous-value'],
      },
    );
  });

  it('treats missing, empty and blank values as an empty map', () => {
    expect(parseConnectorCallbackSecrets(undefined)).toEqual({});
    expect(parseConnectorCallbackSecrets('')).toEqual({});
    expect(parseConnectorCallbackSecrets('   ')).toEqual({});
    expect(parseConnectorCallbackSecrets('{}')).toEqual({});
  });

  it('rejects invalid JSON', () => {
    expect(() => parseConnectorCallbackSecrets('{not json')).toThrow(
      'CONNECTOR_CALLBACK_SIGNING_SECRETS must be valid JSON',
    );
  });

  it('rejects a non-object root', () => {
    expect(() => parseConnectorCallbackSecrets('[]')).toThrow(
      'CONNECTOR_CALLBACK_SIGNING_SECRETS must be a JSON object',
    );
    expect(() => parseConnectorCallbackSecrets('"signing-value"')).toThrow(
      'CONNECTOR_CALLBACK_SIGNING_SECRETS must be a JSON object',
    );
  });

  it('rejects an empty rotation list', () => {
    expect(() => parseConnectorCallbackSecrets('{"tsh_kyc":[]}')).toThrow(
      'CONNECTOR_CALLBACK_SIGNING_SECRETS.tsh_kyc must list at least one secret',
    );
  });

  it('rejects non-string and blank secrets', () => {
    expect(() => parseConnectorCallbackSecrets('{"tsh_kyc":1000}')).toThrow(
      'CONNECTOR_CALLBACK_SIGNING_SECRETS.tsh_kyc must contain non-empty string secrets',
    );
    expect(() => parseConnectorCallbackSecrets('{"tsh_kyc":["value",null]}')).toThrow(
      'CONNECTOR_CALLBACK_SIGNING_SECRETS.tsh_kyc must contain non-empty string secrets',
    );
    expect(() => parseConnectorCallbackSecrets('{"tsh_kyc":"   "}')).toThrow(
      'CONNECTOR_CALLBACK_SIGNING_SECRETS.tsh_kyc must contain non-empty string secrets',
    );
  });

  it('rejects a blank connector type', () => {
    expect(() => parseConnectorCallbackSecrets('{"  ":"signing-value"}')).toThrow(
      'CONNECTOR_CALLBACK_SIGNING_SECRETS connector types must be non-empty',
    );
  });

  it('does not leak a secret value into a thrown message', () => {
    expect(() =>
      parseConnectorCallbackSecrets('{"tsh_kyc":["ok-value",{"nested":"leaked"}]}'),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('leaked'),
      }) as Error,
    );
  });

  it('does not pollute the prototype chain through a __proto__ key', () => {
    const secrets = parseConnectorCallbackSecrets('{"__proto__":"signing-value"}');

    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty('tsh_kyc');
    expect(Object.getOwnPropertyNames(secrets)).toEqual(['__proto__']);
  });
});
