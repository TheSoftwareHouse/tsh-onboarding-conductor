import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../../config/app.config';
import { LeanUnavailableException } from '../../../errors/lean-unavailable.exception';
import { LeanClient } from './lean-client';
import {
  LEAN_ERROR_STATUS_INVALID_PARAMETERS,
  LEAN_ERROR_STATUS_UNKNOWN_CUSTOMER,
  LEAN_ERROR_STATUS_UNRECOGNIZED,
  LEAN_TOKEN_REFRESH_MARGIN_MS,
  type LeanCredentials,
} from './lean-contract';

const AUTH_BASE_URL = 'https://auth.lean.test';
const API_BASE_URL = 'https://api.lean.test';
const ENTITY_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const MILLISECONDS_PER_SECOND = 1000;
const TOKEN_LIFETIME_SECONDS = 3599;

const createConfigService = () =>
  ({
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string | number> = {
        LEAN_AUTH_BASE_URL: AUTH_BASE_URL,
        LEAN_API_BASE_URL: API_BASE_URL,
        LEAN_TIMEOUT_MS: 1000,
      };

      return values[key];
    }),
  }) as unknown as ConfigService<AppConfig, true>;

const credentials: LeanCredentials = { clientId: 'client-id-1', clientSecret: 'client-secret-1' };

const createResponse = (status: number, body: unknown = undefined) => ({
  ok: status >= 200 && status < 300,
  status,
  text: jest.fn().mockResolvedValue(body === undefined ? '' : JSON.stringify(body)),
});

const tokenResponse = (accessToken: string, expiresIn = TOKEN_LIFETIME_SECONDS) =>
  createResponse(200, {
    access_token: accessToken,
    token_type: 'Bearer',
    scope: 'api',
    expires_in: expiresIn,
  });

const customerBody = { customer_id: CUSTOMER_ID, app_user_id: 'onboarding-1' };

type FetchCallArgs = [string, RequestInit & { headers: Record<string, string> }];

describe('LeanClient', () => {
  const fetchMock = jest.fn();
  let nowMs: number;

  const callsTo = (urlPrefix: string): FetchCallArgs[] =>
    (fetchMock.mock.calls as FetchCallArgs[]).filter(([url]) => url.startsWith(urlPrefix));

  beforeEach(() => {
    nowMs = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
  });

  afterAll(() => {
    delete (global as { fetch?: unknown }).fetch;
  });

  describe('token', () => {
    it('posts the credentials as a form body for the api scope and sends the token as a bearer', async () => {
      const client = new LeanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse('token-1'))
        .mockResolvedValueOnce(createResponse(200, customerBody));

      const result = await client.getCustomer(credentials, CUSTOMER_ID);

      const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as FetchCallArgs;
      const form = new URLSearchParams(tokenInit.body as string);
      const [apiUrl, apiInit] = fetchMock.mock.calls[1] as FetchCallArgs;

      expect(tokenUrl).toBe(`${AUTH_BASE_URL}/oauth2/token`);
      expect(tokenInit.method).toBe('POST');
      expect(tokenInit.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(Object.fromEntries(form)).toEqual({
        client_id: 'client-id-1',
        client_secret: 'client-secret-1',
        grant_type: 'client_credentials',
        scope: 'api',
      });
      expect(apiUrl).toBe(`${API_BASE_URL}/customers/v1/${CUSTOMER_ID}`);
      expect(apiInit.headers.Authorization).toBe('Bearer token-1');
      expect(result).toEqual({ kind: 'ok', body: customerBody });
    });

    it('reuses a cached token across calls', async () => {
      const client = new LeanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse('token-1'))
        .mockResolvedValue(createResponse(200, customerBody));

      await client.getCustomer(credentials, CUSTOMER_ID);
      await client.getCustomer(credentials, CUSTOMER_ID);

      expect(callsTo(AUTH_BASE_URL)).toHaveLength(1);
      expect(callsTo(API_BASE_URL)).toHaveLength(2);
    });

    it('refreshes the token once it is within the margin of expiring', async () => {
      const client = new LeanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse('token-1'))
        .mockResolvedValueOnce(createResponse(200, customerBody))
        .mockResolvedValueOnce(tokenResponse('token-2'))
        .mockResolvedValueOnce(createResponse(200, customerBody));

      await client.getCustomer(credentials, CUSTOMER_ID);
      nowMs += TOKEN_LIFETIME_SECONDS * MILLISECONDS_PER_SECOND - LEAN_TOKEN_REFRESH_MARGIN_MS;
      await client.getCustomer(credentials, CUSTOMER_ID);

      const [, secondApiInit] = callsTo(API_BASE_URL)[1];

      expect(callsTo(AUTH_BASE_URL)).toHaveLength(2);
      expect(secondApiInit.headers.Authorization).toBe('Bearer token-2');
    });

    it('keeps using the token just before the margin', async () => {
      const client = new LeanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse('token-1'))
        .mockResolvedValue(createResponse(200, customerBody));

      await client.getCustomer(credentials, CUSTOMER_ID);
      nowMs += TOKEN_LIFETIME_SECONDS * MILLISECONDS_PER_SECOND - LEAN_TOKEN_REFRESH_MARGIN_MS - 1;
      await client.getCustomer(credentials, CUSTOMER_ID);

      expect(callsTo(AUTH_BASE_URL)).toHaveLength(1);
    });

    it('refreshes the token and repeats the request once on a 401', async () => {
      const client = new LeanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse('token-1'))
        .mockResolvedValueOnce(createResponse(401))
        .mockResolvedValueOnce(tokenResponse('token-2'))
        .mockResolvedValueOnce(createResponse(200, customerBody));

      const result = await client.getCustomer(credentials, CUSTOMER_ID);

      const apiCalls = callsTo(API_BASE_URL);

      expect(callsTo(AUTH_BASE_URL)).toHaveLength(2);
      expect(apiCalls).toHaveLength(2);
      expect(apiCalls[0][1].headers.Authorization).toBe('Bearer token-1');
      expect(apiCalls[1][1].headers.Authorization).toBe('Bearer token-2');
      expect(result).toEqual({ kind: 'ok', body: customerBody });
    });

    it('returns a second 401 to the caller instead of retrying again', async () => {
      const client = new LeanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse('token-1'))
        .mockResolvedValueOnce(createResponse(401))
        .mockResolvedValueOnce(tokenResponse('token-2'))
        .mockResolvedValueOnce(createResponse(401));

      const result = await client.getCustomer(credentials, CUSTOMER_ID);

      expect(callsTo(API_BASE_URL)).toHaveLength(2);
      expect(result).toEqual({
        kind: 'error',
        httpStatus: 401,
        body: { status: LEAN_ERROR_STATUS_UNRECOGNIZED, message: '' },
      });
    });

    it('misses the cache when the secret changes', async () => {
      const client = new LeanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse('token-1'))
        .mockResolvedValueOnce(createResponse(200, customerBody))
        .mockResolvedValueOnce(tokenResponse('token-2'))
        .mockResolvedValueOnce(createResponse(200, customerBody));

      await client.getCustomer(credentials, CUSTOMER_ID);
      await client.getCustomer({ ...credentials, clientSecret: 'client-secret-2' }, CUSTOMER_ID);

      const [, rotatedInit] = callsTo(API_BASE_URL)[1];

      expect(callsTo(AUTH_BASE_URL)).toHaveLength(2);
      expect(rotatedInit.headers.Authorization).toBe('Bearer token-2');
    });

    it('treats credentials Lean refuses as unavailable', async () => {
      const client = new LeanClient(createConfigService());
      fetchMock.mockResolvedValueOnce(
        createResponse(401, {
          status: LEAN_ERROR_STATUS_INVALID_PARAMETERS,
          message: 'invalid_client',
        }),
      );

      await expect(client.getCustomer(credentials, CUSTOMER_ID)).rejects.toBeInstanceOf(
        LeanUnavailableException,
      );
      expect(callsTo(API_BASE_URL)).toHaveLength(0);
    });
  });

  describe('failures', () => {
    it('throws unavailable on a timeout', async () => {
      const client = new LeanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse('token-1'))
        .mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));

      await expect(client.getCustomer(credentials, CUSTOMER_ID)).rejects.toBeInstanceOf(
        LeanUnavailableException,
      );
    });

    it('throws unavailable on a network error', async () => {
      const client = new LeanClient(createConfigService());
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(client.getCustomer(credentials, CUSTOMER_ID)).rejects.toBeInstanceOf(
        LeanUnavailableException,
      );
    });

    it('throws unavailable on a 5xx', async () => {
      const client = new LeanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse('token-1'))
        .mockResolvedValueOnce(createResponse(503));

      await expect(client.getCustomer(credentials, CUSTOMER_ID)).rejects.toBeInstanceOf(
        LeanUnavailableException,
      );
    });

    it('throws unavailable on a 2xx whose body is not JSON', async () => {
      const client = new LeanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse('token-1'))
        .mockResolvedValueOnce(createResponse(200));

      await expect(client.getCustomer(credentials, CUSTOMER_ID)).rejects.toBeInstanceOf(
        LeanUnavailableException,
      );
    });

    it('never logs the credentials, the token, the IBAN or the national ID', async () => {
      const client = new LeanClient(createConfigService());
      const warn = jest.spyOn(Logger.prototype, 'warn');
      const debug = jest.spyOn(Logger.prototype, 'debug');
      fetchMock
        .mockResolvedValueOnce(tokenResponse('token-secret-1'))
        .mockResolvedValueOnce(createResponse(500));

      await expect(
        client.verifyAccount(credentials, {
          iban: 'SA0000000000000000000000',
          nationalId: '1000000001',
        }),
      ).rejects.toBeInstanceOf(LeanUnavailableException);

      const logged = JSON.stringify([...warn.mock.calls, ...debug.mock.calls]);

      for (const secret of [
        credentials.clientId,
        credentials.clientSecret,
        'token-secret-1',
        'SA0000000000000000000000',
        '1000000001',
      ]) {
        expect(logged).not.toContain(secret);
      }
    });
  });

  describe('endpoints', () => {
    const primeToken = () => fetchMock.mockResolvedValueOnce(tokenResponse('token-1'));

    it('passes a 400 body through as a typed error', async () => {
      const client = new LeanClient(createConfigService());
      const body = {
        status: LEAN_ERROR_STATUS_INVALID_PARAMETERS,
        message: 'Account details validation failed. Invalid IBAN',
        metadata: null,
      };
      primeToken();
      fetchMock.mockResolvedValueOnce(createResponse(400, body));

      const result = await client.verifyAccount(credentials, {
        iban: 'XX',
        nationalId: '1000000001',
      });

      expect(result).toEqual({ kind: 'error', httpStatus: 400, body });
    });

    it('verifies an account with the Saudi personal IBAN request', async () => {
      const client = new LeanClient(createConfigService());
      const verification = {
        status: 'OK',
        results_id: 'result-1',
        message: 'Data successfully retrieved',
        status_detail: null,
        verifications: {
          account_ownership_verified: true,
          matching: null,
          account_status: 'ACTIVE',
          account_holder_name: 'Test Holder',
          verification_method: 'CONFIRMATION_OF_PAYEE_SERVICE',
        },
      };
      primeToken();
      fetchMock.mockResolvedValueOnce(createResponse(200, verification));

      const result = await client.verifyAccount(credentials, {
        iban: 'SA0000000000000000000000',
        nationalId: '1000000001',
      });

      const [url, init] = callsTo(API_BASE_URL)[0];

      expect(url).toBe(`${API_BASE_URL}/verifications/v1/accounts`);
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual({
        country_code: 'SA',
        type: 'PERSONAL',
        account_details: { type: 'IBAN', value: 'SA0000000000000000000000' },
        identifications: [{ type: 'NATIONAL_ID', value: '1000000001' }],
      });
      expect(result).toEqual({ kind: 'ok', body: verification });
    });

    it('returns an unknown customer as a typed 404', async () => {
      const client = new LeanClient(createConfigService());
      const body = {
        status: LEAN_ERROR_STATUS_UNKNOWN_CUSTOMER,
        message: 'The customer_id provided did not match a resource in our records.',
      };
      primeToken();
      fetchMock.mockResolvedValueOnce(createResponse(404, body));

      const result = await client.getCustomer(credentials, CUSTOMER_ID);

      expect(result).toEqual({ kind: 'error', httpStatus: 404, body });
    });

    it('finds a customer by app user id, creates one and lists its entities', async () => {
      const client = new LeanClient(createConfigService());
      const entities = [
        { id: ENTITY_ID, customer_id: CUSTOMER_ID, bank_identifier: 'BANK_1', created_at: 'now' },
      ];
      primeToken();
      fetchMock
        .mockResolvedValueOnce(createResponse(200, customerBody))
        .mockResolvedValueOnce(createResponse(200, customerBody))
        .mockResolvedValueOnce(createResponse(200, entities));

      await client.findCustomerByAppUserId(credentials, 'onboarding-1');
      await client.createCustomer(credentials, 'onboarding-1');
      const listed = await client.listCustomerEntities(credentials, CUSTOMER_ID);

      const [find, create, list] = callsTo(API_BASE_URL);

      expect(find[0]).toBe(`${API_BASE_URL}/customers/v1/app-user-id/onboarding-1`);
      expect(find[1].method).toBe('GET');
      expect(create[0]).toBe(`${API_BASE_URL}/customers/v1`);
      expect(JSON.parse(create[1].body as string)).toEqual({ app_user_id: 'onboarding-1' });
      expect(list[0]).toBe(`${API_BASE_URL}/customers/v1/${CUSTOMER_ID}/entities`);
      expect(listed).toEqual({ kind: 'ok', body: entities });
    });

    it('requests income synchronously with a POST body', async () => {
      const client = new LeanClient(createConfigService());
      const income = {
        status: 'OK',
        results_id: 'result-1',
        insights: { salary: { currency: 'SAR' } },
      };
      primeToken();
      fetchMock.mockResolvedValueOnce(createResponse(200, income));

      const result = await client.getIncome(credentials, {
        entityId: ENTITY_ID,
        startDate: '2026-04-13',
      });

      const [url, init] = callsTo(API_BASE_URL)[0];

      expect(url).toBe(`${API_BASE_URL}/insights/v2/income?async=false`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        entity_id: ENTITY_ID,
        start_date: '2026-04-13',
        income_type: 'ALL',
      });
      expect(result).toEqual({ kind: 'ok', body: income });
    });

    it('requests employment synchronously with a GET query', async () => {
      const client = new LeanClient(createConfigService());
      const employment = {
        status: 'OK',
        results_id: 'result-1',
        insights: { employment_details: [] },
      };
      primeToken();
      fetchMock.mockResolvedValueOnce(createResponse(200, employment));

      const result = await client.getEmployment(credentials, {
        entityId: ENTITY_ID,
        startDate: '2026-04-13',
      });

      const [url, init] = callsTo(API_BASE_URL)[0];

      expect(url).toBe(
        `${API_BASE_URL}/insights/v2/income/employment?entity_id=${ENTITY_ID}&start_date=2026-04-13&async=false`,
      );
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      expect(result).toEqual({ kind: 'ok', body: employment });
    });

    it('surfaces a 202 insights answer as pending', async () => {
      const client = new LeanClient(createConfigService());
      const pending = { status: 'PENDING', results_id: 'result-1', message: 'Please wait' };
      primeToken();
      fetchMock.mockResolvedValueOnce(createResponse(202, pending));

      const result = await client.getIncome(credentials, {
        entityId: ENTITY_ID,
        startDate: '2026-04-13',
      });

      expect(result).toEqual({ kind: 'pending', body: pending });
    });

    it('surfaces a 501 insights answer as unsupported', async () => {
      const client = new LeanClient(createConfigService());
      const unsupported = {
        status: 'FAILED',
        message: 'Sync requests are not supported',
        results_id: 'result-1',
      };
      primeToken();
      fetchMock.mockResolvedValueOnce(createResponse(501, unsupported));

      const result = await client.getEmployment(credentials, {
        entityId: ENTITY_ID,
        startDate: '2026-04-13',
      });

      expect(result).toEqual({ kind: 'unsupported', body: unsupported });
    });

    it('returns an unknown entity on an insights call as a typed 404', async () => {
      const client = new LeanClient(createConfigService());
      const body = { status: 'UNKNOWN_ENTITY', message: 'The entity_id provided did not match.' };
      primeToken();
      fetchMock.mockResolvedValueOnce(createResponse(404, body));

      const result = await client.getIncome(credentials, {
        entityId: ENTITY_ID,
        startDate: '2026-04-13',
      });

      expect(result).toEqual({ kind: 'error', httpStatus: 404, body });
    });
  });
});
