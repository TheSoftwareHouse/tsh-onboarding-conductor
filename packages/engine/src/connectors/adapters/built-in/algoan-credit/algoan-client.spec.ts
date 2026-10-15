import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../../config/app.config';
import { AlgoanRequestRejectedError } from '../../../errors/algoan-request-rejected.error';
import { AlgoanUnavailableException } from '../../../errors/algoan-unavailable.exception';
import { AlgoanClient } from './algoan-client';
import type { AlgoanCredentials } from './algoan-contract';

const BASE_URL = 'https://api.algoan.com';

const createConfigService = () =>
  ({
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string | number> = {
        ALGOAN_API_BASE_URL: BASE_URL,
        ALGOAN_TIMEOUT_MS: 1000,
      };

      return values[key];
    }),
  }) as unknown as ConfigService<AppConfig, true>;

const credentials: AlgoanCredentials = { clientId: 'client-1', clientSecret: 'secret-1' };

const createResponse = (status: number, bodyText = '') => ({
  ok: status >= 200 && status < 300,
  status,
  text: jest.fn().mockResolvedValue(bodyText),
});

const tokenResponse = (accessToken = 'token-1', expiresIn = 86400) =>
  createResponse(
    200,
    JSON.stringify({ access_token: accessToken, expires_in: expiresIn, token_type: 'Bearer' }),
  );

type FetchCallArgs = [string, RequestInit & { headers: Record<string, string> }];

describe('AlgoanClient', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useRealTimers();
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
  });

  afterAll(() => {
    delete (global as { fetch?: unknown }).fetch;
  });

  const call = (index: number) => fetchMock.mock.calls[index] as FetchCallArgs;

  describe('getToken', () => {
    it('posts a form-encoded client-credentials body and returns the access token', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock.mockResolvedValueOnce(tokenResponse());

      await expect(client.getToken(credentials)).resolves.toBe('token-1');

      const [url, init] = call(0);

      expect(url).toBe(`${BASE_URL}/v1/oauth/token`);
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
        grant_type: 'client_credentials',
        client_id: 'client-1',
        client_secret: 'secret-1',
      });
    });

    it('serves a second call from the cache', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock.mockResolvedValueOnce(tokenResponse());

      await client.getToken(credentials);
      await client.getToken(credentials);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps one token per client id', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse('token-a'))
        .mockResolvedValueOnce(tokenResponse('token-b'));

      await expect(client.getToken(credentials)).resolves.toBe('token-a');
      await expect(client.getToken({ ...credentials, clientId: 'client-2' })).resolves.toBe(
        'token-b',
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('refreshes the token 60 seconds before it expires', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-15T10:00:00Z') });
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse('token-old', 3600))
        .mockResolvedValueOnce(tokenResponse('token-new', 3600));

      await expect(client.getToken(credentials)).resolves.toBe('token-old');

      jest.setSystemTime(new Date('2026-10-15T10:58:59Z'));
      await expect(client.getToken(credentials)).resolves.toBe('token-old');

      jest.setSystemTime(new Date('2026-10-15T10:59:00Z'));
      await expect(client.getToken(credentials)).resolves.toBe('token-new');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rejects a token response without an access token as unavailable', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock.mockResolvedValueOnce(createResponse(200, JSON.stringify({ expires_in: 10 })));

      await expect(client.getToken(credentials)).rejects.toBeInstanceOf(AlgoanUnavailableException);
    });

    it('surfaces refused credentials as a typed rejection', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock.mockResolvedValueOnce(
        createResponse(401, JSON.stringify({ code: 'INVALID_CLIENT', message: 'nope' })),
      );

      await expect(client.getToken(credentials)).rejects.toMatchObject({
        name: 'AlgoanRequestRejectedError',
        status: 401,
        code: 'INVALID_CLIENT',
      });
    });
  });

  describe('customers', () => {
    it('creates a customer with a bearer-authorised JSON POST', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          createResponse(201, JSON.stringify({ id: 'c-1', customIdentifier: 'onb-1' })),
        );

      await expect(client.createCustomer(credentials, 'onb-1')).resolves.toEqual({
        id: 'c-1',
        customIdentifier: 'onb-1',
      });

      const [url, init] = call(1);

      expect(url).toBe(`${BASE_URL}/v2/customers`);
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer token-1');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual({ customIdentifier: 'onb-1' });
    });

    it('turns a 422 into a typed rejection carrying the Algoan code', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
        createResponse(
          422,
          JSON.stringify({
            code: 'ALREADY_EXISTS',
            message: 'customIdentifier onb-1 already exists',
            status: 422,
          }),
        ),
      );

      const failure = await client.createCustomer(credentials, 'onb-1').catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(AlgoanRequestRejectedError);
      expect(failure).toMatchObject({
        status: 422,
        code: 'ALREADY_EXISTS',
        reason: 'customIdentifier onb-1 already exists',
      });
    });

    it('keeps a typed rejection when the error body is not JSON', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(createResponse(400, '<html>bad</html>'));

      await expect(client.createCustomer(credentials, 'onb-1')).rejects.toMatchObject({
        status: 400,
        code: undefined,
      });
    });

    it('finds a customer by its URL-encoded JSON filter', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
        createResponse(
          200,
          JSON.stringify({
            resources: [{ id: 'c-1', customIdentifier: 'onb-1' }],
            pagination: { next: null },
          }),
        ),
      );

      await expect(client.findCustomerByIdentifier(credentials, 'onb-1')).resolves.toEqual({
        id: 'c-1',
        customIdentifier: 'onb-1',
      });
      expect(call(1)[0]).toBe(
        `${BASE_URL}/v2/customers?filter=${encodeURIComponent('{"customIdentifier":"onb-1"}')}`,
      );
    });

    it('returns undefined when no customer matches', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          createResponse(200, JSON.stringify({ resources: [], pagination: { next: null } })),
        );

      await expect(client.findCustomerByIdentifier(credentials, 'onb-1')).resolves.toBeUndefined();
    });

    it('reads a customer by id', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          createResponse(200, JSON.stringify({ id: 'c-1', customIdentifier: 'onb-1' })),
        );

      await expect(client.getCustomer(credentials, 'c-1')).resolves.toEqual({
        id: 'c-1',
        customIdentifier: 'onb-1',
      });
      expect(call(1)[0]).toBe(`${BASE_URL}/v2/customers/c-1`);
      expect(call(1)[1].method).toBe('GET');
    });
  });

  describe('analyses', () => {
    it('creates an analysis under the customer', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          createResponse(201, JSON.stringify({ id: 'a-1', status: 'CREATED' })),
        );

      await expect(
        client.createAnalysis(credentials, 'c-1', { accounts: [], format: 'ALGOAN' }),
      ).resolves.toEqual({
        id: 'a-1',
        status: 'CREATED',
        scores: undefined,
        creditInsights: undefined,
        metadata: undefined,
        error: undefined,
      });
      expect(call(1)[0]).toBe(`${BASE_URL}/v2/customers/c-1/analyses`);
      expect(JSON.parse(call(1)[1].body as string)).toEqual({ accounts: [], format: 'ALGOAN' });
    });

    it('reads an analysis with its error', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
        createResponse(
          200,
          JSON.stringify({
            id: 'a-1',
            status: 'ERROR',
            error: { code: 'NO_CHECKING_ACCOUNT', message: 'm' },
          }),
        ),
      );

      await expect(client.getAnalysis(credentials, 'c-1', 'a-1')).resolves.toMatchObject({
        status: 'ERROR',
        error: { code: 'NO_CHECKING_ACCOUNT', message: 'm' },
      });
      expect(call(1)[0]).toBe(`${BASE_URL}/v2/customers/c-1/analyses/a-1`);
    });

    it('reads scores and each credit-insights section', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(createResponse(200, JSON.stringify({ creditScore: { value: 965 } })))
        .mockResolvedValueOnce(createResponse(200, JSON.stringify({ totalAmount: 1 })));

      await expect(client.getScores(credentials, 'c-1', 'a-1')).resolves.toEqual({
        creditScore: { value: 965 },
      });
      await expect(
        client.getCreditInsights(credentials, 'c-1', 'a-1', 'cash-flows'),
      ).resolves.toEqual({ totalAmount: 1 });
      expect(call(1)[0]).toBe(`${BASE_URL}/v2/customers/c-1/analyses/a-1/scores`);
      expect(call(2)[0]).toBe(
        `${BASE_URL}/v2/customers/c-1/analyses/a-1/credit-insights/cash-flows`,
      );
    });

    it('reads the array a cash-flows section answers with', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(createResponse(200, JSON.stringify([{ id: 'flow-1' }])));

      await expect(
        client.getCreditInsights(credentials, 'c-1', 'a-1', 'cash-flows'),
      ).resolves.toEqual([{ id: 'flow-1' }]);
    });

    it('reads essentials', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(createResponse(200, JSON.stringify({ historicalDepth: 99 })));

      await expect(client.getEssentials(credentials, 'c-1', 'a-1')).resolves.toEqual({
        historicalDepth: 99,
      });
      expect(call(1)[0]).toBe(`${BASE_URL}/v2/customers/c-1/analyses/a-1/essentials`);
    });

    it('reads accounts', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          createResponse(
            200,
            JSON.stringify({ resources: [{ id: 'acc-1' }], pagination: { next: null } }),
          ),
        );

      const accounts = await client.listAccounts(credentials, 'c-1', 'a-1');

      expect(accounts.resources).toEqual([{ id: 'acc-1' }]);
      expect(call(1)[0]).toBe(`${BASE_URL}/v2/customers/c-1/analyses/a-1/accounts`);
    });
  });

  describe('listTransactions', () => {
    it('paginates with page and limit and reports whether another page follows', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          createResponse(
            200,
            JSON.stringify({
              resources: [{ id: 't-1' }],
              pagination: { next: `${BASE_URL}/v2/…?page=2` },
            }),
          ),
        )
        .mockResolvedValueOnce(
          createResponse(
            200,
            JSON.stringify({ resources: [{ id: 't-2' }], pagination: { next: null } }),
          ),
        );

      const first = await client.listTransactions(credentials, 'c-1', 'a-1', 1, 50);
      const second = await client.listTransactions(credentials, 'c-1', 'a-1', 2);

      expect(first).toMatchObject({ resources: [{ id: 't-1' }], hasNext: true });
      expect(second).toMatchObject({ resources: [{ id: 't-2' }], hasNext: false });
      expect(call(1)[0]).toBe(
        `${BASE_URL}/v2/customers/c-1/analyses/a-1/transactions?page=1&limit=50`,
      );
      expect(call(2)[0]).toBe(`${BASE_URL}/v2/customers/c-1/analyses/a-1/transactions?page=2`);
    });

    it('rejects a page without a resources array as unavailable', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(createResponse(200, JSON.stringify({ pagination: {} })));

      await expect(client.listTransactions(credentials, 'c-1', 'a-1', 1)).rejects.toBeInstanceOf(
        AlgoanUnavailableException,
      );
    });
  });

  describe('failures', () => {
    it('maps a 5xx to the unavailable exception', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(createResponse(502));

      await expect(client.getCustomer(credentials, 'c-1')).rejects.toBeInstanceOf(
        AlgoanUnavailableException,
      );
    });

    it('maps a network error to the unavailable exception', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(client.getToken(credentials)).rejects.toBeInstanceOf(AlgoanUnavailableException);
    });

    it('maps a timeout to the unavailable exception', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));

      await expect(client.getCustomer(credentials, 'c-1')).rejects.toBeInstanceOf(
        AlgoanUnavailableException,
      );
      expect(call(0)[1].signal).toBeInstanceOf(AbortSignal);
    });

    it('maps a non-JSON success body to the unavailable exception', async () => {
      const client = new AlgoanClient(createConfigService());
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(createResponse(200, 'not json'));

      await expect(client.getCustomer(credentials, 'c-1')).rejects.toBeInstanceOf(
        AlgoanUnavailableException,
      );
    });
  });
});
