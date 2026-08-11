import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import type { AppConfig } from '../../config/app.config';
import { HttpConnectorConfigInvalidError } from '../errors/http-connector-config-invalid.error';
import { HttpConnectorRequestFailedError } from '../errors/http-connector-request-failed.error';
import type { ConnectorExecutionInput } from '../ports/connector-adapter.port';
import { ConnectorExecutionMetadataFlag } from '../ports/connector-execution-result';
import { HttpRequestConnector } from './http-request.connector';

const SECRETS = JSON.stringify({
  kycProvider: { baseUrl: 'https://api.example.com', token: 'secret-token' },
});

const createConnector = (secrets: string = SECRETS): HttpRequestConnector => {
  const configService = {
    get: jest.fn().mockReturnValue(secrets),
    getOrThrow: jest.fn().mockReturnValue(5000),
  } as unknown as ConfigService<AppConfig, true>;

  return new HttpRequestConnector(configService);
};

const createInput = (
  config: Record<string, unknown>,
  overrides: Partial<ConnectorExecutionInput> = {},
): ConnectorExecutionInput => ({
  declaration: { order: 1, config },
  execution: { onboardingId: 'onboarding-1', stepName: 'collect_customer' },
  context: { email: 'user@example.com', age: 42 },
  payload: { customerEmail: 'user@example.com', customerAge: 42 },
  payloadFieldSources: { customerEmail: 'email', customerAge: 'age' },
  ...overrides,
});

const createDeclaration = (
  config: Record<string, unknown>,
): NormalizedWorkflowConnectorDeclaration => ({
  name: 'kyc_provider',
  type: 'http_request',
  canReject: false,
  async: false,
  order: 1,
  fieldMapping: { customerEmail: 'email', customerAge: 'age' },
  config,
});

const jsonResponse = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const fullConfig = {
  request: {
    method: 'POST',
    url: '{{secrets.kycProvider.baseUrl}}/v1/customers',
    headers: { Authorization: 'Bearer {{secrets.kycProvider.token}}' },
    query: { locale: 'en', onboarding: '{{execution.onboardingId}}' },
    body: { email: '{{payload.customerEmail}}', age: '{{payload.customerAge}}' },
  },
};

describe('HttpRequestConnector', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  const lastRequest = () => {
    const [url, init] = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];

    return { url: url as URL, init: init as RequestInit & { headers: Headers } };
  };

  describe('validateDeclaration', () => {
    it('accepts a valid declaration', () => {
      expect(() =>
        createConnector().validateDeclaration(createDeclaration(fullConfig)),
      ).not.toThrow();
    });

    it('rejects a declaration whose config is invalid', () => {
      expect(() =>
        createConnector().validateDeclaration(createDeclaration({ request: { method: 'POST' } })),
      ).toThrow(HttpConnectorConfigInvalidError);
    });

    it('names the connector in the failure message', () => {
      expect(() =>
        createConnector().validateDeclaration(createDeclaration({ request: { method: 'POST' } })),
      ).toThrow('(connector kyc_provider)');
    });
  });

  describe('execute', () => {
    it('sends the configured method, url, query, headers and body', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, { status: 'OK' }));

      const result = await createConnector().execute(createInput(fullConfig));

      expect(result.isAccepted()).toBe(true);

      const { url, init } = lastRequest();
      expect(url.toString()).toBe(
        'https://api.example.com/v1/customers?locale=en&onboarding=onboarding-1',
      );
      expect(init.method).toBe('POST');
      expect(init.headers.get('Authorization')).toBe('Bearer secret-token');
      expect(init.headers.get('Content-Type')).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual({ email: 'user@example.com', age: 42 });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('sends the whole mapped payload when no body is configured', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200));

      await createConnector().execute(
        createInput({ request: { method: 'POST', url: 'https://api.example.com/v1/customers' } }),
      );

      expect(JSON.parse(lastRequest().init.body as string)).toEqual({
        customerEmail: 'user@example.com',
        customerAge: 42,
      });
    });

    it('sends no body for a bodyless method', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200));

      await createConnector().execute(
        createInput({ request: { method: 'GET', url: 'https://api.example.com/v1/status' } }),
      );

      const { init } = lastRequest();
      expect(init.body).toBeUndefined();
      expect(init.headers.get('Content-Type')).toBeNull();
    });

    it('omits query parameters that resolve to null', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200));

      await createConnector().execute(
        createInput(
          {
            request: {
              method: 'GET',
              url: 'https://api.example.com/v1/status',
              query: { ref: '{{payload.customerRef}}', locale: 'en' },
            },
          },
          {
            payload: { customerRef: null },
            payloadFieldSources: { customerRef: 'ref' },
          },
        ),
      );

      expect(lastRequest().url.toString()).toBe('https://api.example.com/v1/status?locale=en');
    });

    it('lets a configured Content-Type header win over the default', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200));

      await createConnector().execute(
        createInput({
          request: {
            method: 'POST',
            url: 'https://api.example.com/v1/customers',
            headers: { 'content-type': 'application/vnd.api+json' },
          },
        }),
      );

      expect(lastRequest().init.headers.get('Content-Type')).toBe('application/vnd.api+json');
    });

    it('uses the configured timeout over the configured default', async () => {
      const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
      fetchSpy.mockResolvedValue(jsonResponse(200));

      await createConnector().execute(
        createInput({
          request: { method: 'GET', url: 'https://api.example.com/v1/status', timeoutMs: 1200 },
        }),
      );
      expect(timeoutSpy).toHaveBeenLastCalledWith(1200);

      await createConnector().execute(
        createInput({ request: { method: 'GET', url: 'https://api.example.com/v1/status' } }),
      );
      expect(timeoutSpy).toHaveBeenLastCalledWith(5000);
    });

    it.each([200, 201, 204])('accepts a %i response', async (status) => {
      fetchSpy.mockResolvedValue(new Response(null, { status }));

      const result = await createConnector().execute(createInput(fullConfig));

      expect(result.isAccepted()).toBe(true);
    });

    it('maps a 4xx body onto retryable field errors keyed by workflow field', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(422, { errors: { customerEmail: ['ALREADY_REGISTERED'] } }),
      );

      const result = await createConnector().execute(createInput(fullConfig));

      expect(result.isInvalidData()).toBe(true);
      expect(result.errors).toEqual({ email: ['ALREADY_REGISTERED'] });
      expect(result.metadata).toEqual({
        [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
      });
    });

    it('reads field errors from a nested errorsPath', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(400, { data: { fieldErrors: { customerAge: ['TOO_YOUNG'] } } }),
      );

      const result = await createConnector().execute(
        createInput({
          ...fullConfig,
          response: { errorsPath: 'data.fieldErrors' },
        }),
      );

      expect(result.errors).toEqual({ age: ['TOO_YOUNG'] });
    });

    it('accepts a single string message and passes unmapped keys through', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(422, { errors: { customerEmail: 'INVALID', other: ['UNMAPPED'] } }),
      );

      const result = await createConnector().execute(createInput(fullConfig));

      expect(result.errors).toEqual({ email: ['INVALID'], other: ['UNMAPPED'] });
    });

    it.each([
      ['an empty body', undefined],
      ['a body without the errors object', { message: 'nope' }],
      ['an errors object with no usable messages', { errors: { customerEmail: 5 } }],
    ])('falls back to a generic error for %s', async (_label, body) => {
      fetchSpy.mockResolvedValue(jsonResponse(400, body));

      const result = await createConnector().execute(createInput(fullConfig));

      expect(result.isInvalidData()).toBe(true);
      expect(result.errors).toEqual({ _connector: ['HTTP_CONNECTOR_REQUEST_REJECTED'] });
    });

    it('falls back to a generic error for a non-JSON body', async () => {
      fetchSpy.mockResolvedValue(new Response('<html>nope</html>', { status: 403 }));

      const result = await createConnector().execute(createInput(fullConfig));

      expect(result.errors).toEqual({ _connector: ['HTTP_CONNECTOR_REQUEST_REJECTED'] });
    });

    it('throws for a 4xx status listed in response.errorStatuses', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(401, { errors: { customerEmail: ['NOPE'] } }));

      await expect(
        createConnector().execute(
          createInput({ ...fullConfig, response: { errorStatuses: [401, 403] } }),
        ),
      ).rejects.toThrow(HttpConnectorRequestFailedError);
    });

    it('throws for a 5xx response', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(503));

      await expect(createConnector().execute(createInput(fullConfig))).rejects.toThrow(
        'unexpected response status 503',
      );
    });

    it('throws when the request cannot be sent', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(createConnector().execute(createInput(fullConfig))).rejects.toThrow(
        'http_request connector call failed for step=collect_customer: ECONNREFUSED',
      );
    });

    it('throws when the request times out', async () => {
      fetchSpy.mockRejectedValue(
        Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        }),
      );

      await expect(createConnector().execute(createInput(fullConfig))).rejects.toThrow(
        HttpConnectorRequestFailedError,
      );
    });

    it('throws when a placeholder cannot be resolved at execution time', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200));

      await expect(
        createConnector().execute(
          createInput(
            {
              request: {
                method: 'GET',
                url: 'https://api.example.com/v1/customers/{{payload.customerEmail}}',
              },
            },
            { payload: {}, payloadFieldSources: { customerEmail: 'email' } },
          ),
        ),
      ).rejects.toThrow('request.url could not be resolved');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does not log resolved secrets', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      fetchSpy.mockResolvedValue(jsonResponse(200));

      await createConnector().execute(createInput(fullConfig));

      const loggedMessages = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(loggedMessages).toContain('method=POST');
      expect(loggedMessages).not.toContain('secret-token');
      expect(loggedMessages).not.toContain('https://api.example.com');
    });
  });
});
