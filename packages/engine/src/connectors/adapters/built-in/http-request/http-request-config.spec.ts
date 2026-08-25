import type { HttpConnectorSecrets } from './http-request-secrets';
import { ConnectorNotConfiguredException } from '../../../errors/connector-not-configured.exception';
import { HttpConnectorConfigInvalidError } from '../../../errors/http-connector-config-invalid.error';
import {
  parseHttpConnectorConfig,
  type HttpConnectorDeclaration,
  type HttpConnectorParseMode,
} from './http-request-config';

const secrets: HttpConnectorSecrets = {
  kycProvider: { baseUrl: 'https://api.example.com', token: 'secret-token' },
};

const createDeclaration = (config: Record<string, unknown>): HttpConnectorDeclaration => ({
  context: 'connector kyc_provider',
  config,
  fieldMapping: { customerEmail: 'email', customerAge: 'age' },
});

const parse = (config: Record<string, unknown>, mode?: HttpConnectorParseMode) =>
  parseHttpConnectorConfig(createDeclaration(config), secrets, mode);

describe('parseHttpConnectorConfig', () => {
  it('parses a full configuration', () => {
    const config = parse({
      request: {
        method: 'POST',
        url: '{{secrets.kycProvider.baseUrl}}/v1/customers',
        headers: { Authorization: 'Bearer {{secrets.kycProvider.token}}' },
        query: { locale: 'en', onboarding: '{{execution.onboardingId}}' },
        body: { email: '{{payload.customerEmail}}', age: '{{payload.customerAge}}' },
        timeoutMs: 2500,
      },
      response: { errorsPath: 'data.fieldErrors', errorStatuses: [401, 403] },
    });

    expect(config).toEqual({
      request: {
        method: 'POST',
        url: '{{secrets.kycProvider.baseUrl}}/v1/customers',
        headers: { Authorization: 'Bearer {{secrets.kycProvider.token}}' },
        query: { locale: 'en', onboarding: '{{execution.onboardingId}}' },
        body: { email: '{{payload.customerEmail}}', age: '{{payload.customerAge}}' },
        timeoutMs: 2500,
      },
      response: { errorsPath: 'data.fieldErrors', errorStatuses: [401, 403] },
    });
  });

  it('applies defaults for the optional sections', () => {
    const config = parse({
      request: { method: 'GET', url: 'https://api.example.com/v1/status' },
    });

    expect(config.request.headers).toEqual({});
    expect(config.request.query).toEqual({});
    expect(config.request.body).toBeUndefined();
    expect(config.request.timeoutMs).toBeUndefined();
    expect(config.response).toEqual({ errorsPath: 'errors', errorStatuses: [] });
  });

  it('rejects unknown config sections and request keys', () => {
    expect(() =>
      parse({ request: { method: 'GET', url: 'https://a.example.com' }, retries: 3 }),
    ).toThrow('unknown config section(s): retries');
    expect(() =>
      parse({ request: { method: 'GET', url: 'https://a.example.com', followRedirects: true } }),
    ).toThrow('unknown request key(s): followRedirects');
  });

  it('rejects a missing or malformed request section', () => {
    expect(() => parse({})).toThrow('request must be an object');
    expect(() => parse({ request: [] })).toThrow('request must be an object');
  });

  it('rejects an unsupported method', () => {
    expect(() => parse({ request: { method: 'get', url: 'https://a.example.com' } })).toThrow(
      'request.method must be one of GET, POST, PUT, PATCH, DELETE',
    );
    expect(() => parse({ request: { method: 'TRACE', url: 'https://a.example.com' } })).toThrow(
      'request.method must be one of',
    );
    expect(() => parse({ request: { url: 'https://a.example.com' } })).toThrow(
      'request.method must be one of',
    );
  });

  it('rejects a missing or blank url', () => {
    expect(() => parse({ request: { method: 'GET' } })).toThrow(
      'request.url must be a non-empty string',
    );
    expect(() => parse({ request: { method: 'GET', url: '   ' } })).toThrow(
      'request.url must be a non-empty string',
    );
  });

  it('rejects a url that does not resolve to an absolute http(s) URL', () => {
    expect(() => parse({ request: { method: 'GET', url: '/v1/customers' } })).toThrow(
      'request.url must resolve to an absolute URL',
    );
    expect(() => parse({ request: { method: 'GET', url: 'ftp://files.example.com' } })).toThrow(
      'request.url must use the http or https protocol',
    );
  });

  it('accepts a url whose host comes from a secret', () => {
    expect(() =>
      parse({ request: { method: 'GET', url: '{{secrets.kycProvider.baseUrl}}/v1/customers' } }),
    ).not.toThrow();
  });

  it('rejects a body on a bodyless method', () => {
    expect(() =>
      parse({ request: { method: 'GET', url: 'https://a.example.com', body: { a: 1 } } }),
    ).toThrow('request.body is not allowed for method GET');
    expect(() =>
      parse({ request: { method: 'DELETE', url: 'https://a.example.com', body: {} } }),
    ).toThrow('request.body is not allowed for method DELETE');
  });

  it('rejects non-string header and query values', () => {
    expect(() =>
      parse({
        request: { method: 'GET', url: 'https://a.example.com', headers: { 'X-Tries': 3 } },
      }),
    ).toThrow('request.headers.X-Tries must be a string');
    expect(() =>
      parse({ request: { method: 'GET', url: 'https://a.example.com', query: { page: 1 } } }),
    ).toThrow('request.query.page must be a string');
    expect(() =>
      parse({ request: { method: 'GET', url: 'https://a.example.com', headers: [] } }),
    ).toThrow('request.headers must be an object');
  });

  it('rejects an out-of-range or non-integer timeout', () => {
    expect(() =>
      parse({ request: { method: 'GET', url: 'https://a.example.com', timeoutMs: 50 } }),
    ).toThrow('request.timeoutMs must be between 100 and 30000');
    expect(() =>
      parse({ request: { method: 'GET', url: 'https://a.example.com', timeoutMs: 30001 } }),
    ).toThrow('request.timeoutMs must be between 100 and 30000');
    expect(() =>
      parse({ request: { method: 'GET', url: 'https://a.example.com', timeoutMs: 1.5 } }),
    ).toThrow('request.timeoutMs must be an integer');
  });

  it('rejects an invalid response section', () => {
    expect(() =>
      parse({
        request: { method: 'GET', url: 'https://a.example.com' },
        response: { errorsPath: '' },
      }),
    ).toThrow('response.errorsPath must be a non-empty string');
    expect(() =>
      parse({
        request: { method: 'GET', url: 'https://a.example.com' },
        response: { errorStatuses: [500] },
      }),
    ).toThrow('response.errorStatuses must contain 4xx status codes only');
    expect(() =>
      parse({
        request: { method: 'GET', url: 'https://a.example.com' },
        response: { errorStatuses: 401 },
      }),
    ).toThrow('response.errorStatuses must be an array');
  });

  it('rejects a payload placeholder that is missing from fieldMapping', () => {
    expect(() =>
      parse({
        request: {
          method: 'POST',
          url: 'https://a.example.com',
          body: { name: '{{payload.customerName}}' },
        },
      }),
    ).toThrow('references a payload key that is missing from fieldMapping');
  });

  it("rejects (in 'resolved' mode, the default) a secret placeholder that resolves nowhere", () => {
    expect(() =>
      parse({
        request: {
          method: 'GET',
          url: 'https://a.example.com',
          headers: { Authorization: 'Bearer {{secrets.kycProvider.apiKey}}' },
        },
      }),
    ).toThrow(ConnectorNotConfiguredException);
    expect(() =>
      parse({
        request: {
          method: 'GET',
          url: 'https://a.example.com',
          headers: { Authorization: 'Bearer {{secrets.otherProvider.token}}' },
        },
      }),
    ).toThrow('no value resolves for http_request.otherProvider.token');
  });

  it("accepts (in 'shape' mode) a secret placeholder with no configured value", () => {
    expect(() =>
      parse(
        {
          request: {
            method: 'GET',
            url: 'https://a.example.com',
            headers: { Authorization: 'Bearer {{secrets.kycProvider.apiKey}}' },
          },
        },
        'shape',
      ),
    ).not.toThrow();
    expect(() =>
      parse(
        {
          request: {
            method: 'GET',
            url: 'https://a.example.com',
            headers: { Authorization: 'Bearer {{secrets.otherProvider.token}}' },
          },
        },
        'shape',
      ),
    ).not.toThrow();
  });

  it("resolves a URL built entirely from an unconfigured secret in 'shape' mode via a probe value", () => {
    expect(() =>
      parse(
        {
          request: {
            method: 'GET',
            url: '{{secrets.kycProvider.missingHost}}/v1/customers',
          },
        },
        'shape',
      ),
    ).not.toThrow();
  });

  it('rejects a malformed secret reference in both modes', () => {
    const oneSegment = {
      request: {
        method: 'GET',
        url: 'https://a.example.com',
        headers: { Authorization: 'Bearer {{secrets.token}}' },
      },
    };
    const threeSegments = {
      request: {
        method: 'GET',
        url: 'https://a.example.com',
        headers: { Authorization: 'Bearer {{secrets.a.b.c}}' },
      },
    };

    expect(() => parse(oneSegment, 'shape')).toThrow(HttpConnectorConfigInvalidError);
    expect(() => parse(oneSegment, 'resolved')).toThrow(HttpConnectorConfigInvalidError);
    expect(() => parse(threeSegments, 'shape')).toThrow(HttpConnectorConfigInvalidError);
    expect(() => parse(threeSegments, 'resolved')).toThrow(HttpConnectorConfigInvalidError);
  });

  it('rejects a payload placeholder missing from fieldMapping in both modes', () => {
    const config = {
      request: {
        method: 'POST',
        url: 'https://a.example.com',
        body: { name: '{{payload.customerName}}' },
      },
    };

    expect(() => parse(config, 'shape')).toThrow(
      'references a payload key that is missing from fieldMapping',
    );
    expect(() => parse(config, 'resolved')).toThrow(
      'references a payload key that is missing from fieldMapping',
    );
  });

  it('rejects unknown placeholder namespaces and malformed placeholders', () => {
    expect(() =>
      parse({
        request: { method: 'POST', url: 'https://a.example.com', body: { a: '{{context.email}}' } },
      }),
    ).toThrow('Unknown placeholder namespace "context"');
    expect(() =>
      parse({
        request: { method: 'POST', url: 'https://a.example.com', body: { a: '{{payload}}' } },
      }),
    ).toThrow('Malformed placeholder');
  });

  it('reports failures as HttpConnectorConfigInvalidError carrying the declaration context', () => {
    expect(() => parse({})).toThrow(HttpConnectorConfigInvalidError);
    expect(() => parse({})).toThrow(
      'Invalid http_request connector config (connector kyc_provider): request must be an object',
    );
  });
});
