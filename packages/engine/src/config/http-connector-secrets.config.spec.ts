import { parseHttpConnectorSecrets } from './http-connector-secrets.config';

describe('parseHttpConnectorSecrets', () => {
  it('parses a nested secrets object', () => {
    const secrets = parseHttpConnectorSecrets(
      '{"kycProvider":{"baseUrl":"https://api.example.com","token":"abc"}}',
    );

    expect(secrets).toEqual({
      kycProvider: { baseUrl: 'https://api.example.com', token: 'abc' },
    });
  });

  it('treats missing, empty and blank values as an empty map', () => {
    expect(parseHttpConnectorSecrets(undefined)).toEqual({});
    expect(parseHttpConnectorSecrets('')).toEqual({});
    expect(parseHttpConnectorSecrets('   ')).toEqual({});
    expect(parseHttpConnectorSecrets('{}')).toEqual({});
  });

  it('rejects invalid JSON', () => {
    expect(() => parseHttpConnectorSecrets('{not json')).toThrow(
      'HTTP_CONNECTOR_SECRETS must be valid JSON',
    );
  });

  it('rejects a non-object root', () => {
    expect(() => parseHttpConnectorSecrets('[]')).toThrow(
      'HTTP_CONNECTOR_SECRETS must be a JSON object',
    );
    expect(() => parseHttpConnectorSecrets('"token"')).toThrow(
      'HTTP_CONNECTOR_SECRETS must be a JSON object',
    );
  });

  it('rejects an alias that is not an object', () => {
    expect(() => parseHttpConnectorSecrets('{"kycProvider":"abc"}')).toThrow(
      'HTTP_CONNECTOR_SECRETS.kycProvider must be a JSON object',
    );
  });

  it('rejects a non-string secret value', () => {
    expect(() => parseHttpConnectorSecrets('{"kycProvider":{"timeout":1000}}')).toThrow(
      'HTTP_CONNECTOR_SECRETS.kycProvider.timeout must be a string',
    );
  });

  it('rejects a blank alias', () => {
    expect(() => parseHttpConnectorSecrets('{"  ":{"token":"abc"}}')).toThrow(
      'HTTP_CONNECTOR_SECRETS aliases must be non-empty',
    );
  });
});
