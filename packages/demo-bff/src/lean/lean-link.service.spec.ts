import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { LeanLinkService } from './lean-link.service';

const CONFIG = {
  LEAN_CLIENT_ID: 'app-token-1',
  LEAN_CLIENT_SECRET: 'secret-1',
  LEAN_AUTH_BASE_URL: 'https://auth.sandbox.sa.leantech.me/',
  LEAN_API_BASE_URL: 'https://sandbox.sa.leantech.me',
  ENGINE_REQUEST_TIMEOUT_MS: 5000,
} as const;
const ONBOARDING_ID = '33333333-3333-4333-8333-333333333333';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const REDIRECTS = { success: 'https://demo.test/ok', fail: 'https://demo.test/fail' };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const service = () =>
  new LeanLinkService({
    get: (key: keyof typeof CONFIG) => CONFIG[key],
  } as unknown as ConfigService<AppConfig, true>);

describe('LeanLinkService', () => {
  let fetchSpy: jest.SpyInstance;
  const calls = (): Array<{ method: string; url: string; body: string | undefined }> =>
    fetchSpy.mock.calls.map(([url, init]: [string, RequestInit]) => ({
      method: init.method ?? 'GET',
      url,
      body: typeof init.body === 'string' ? init.body : undefined,
    }));

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  it('mints the api token, reuses an existing customer and answers what the widget needs', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(200, { access_token: 'api-token', expires_in: 3599 }))
      .mockResolvedValueOnce(json(200, { customer_id: CUSTOMER_ID, app_user_id: ONBOARDING_ID }))
      .mockResolvedValueOnce(json(200, { access_token: 'customer-token', expires_in: 3599 }));

    const link = await service().createLink(ONBOARDING_ID, REDIRECTS);

    expect(link).toEqual({
      appToken: 'app-token-1',
      customerId: CUSTOMER_ID,
      accessToken: 'customer-token',
      sandbox: true,
      permissions: ['identity', 'accounts', 'balance', 'transactions'],
      accountType: 'PERSONAL',
      successRedirectUrl: REDIRECTS.success,
      failRedirectUrl: REDIRECTS.fail,
    });
    expect(calls().map(({ method, url }) => `${method} ${url}`)).toEqual([
      'POST https://auth.sandbox.sa.leantech.me/oauth2/token',
      `GET https://sandbox.sa.leantech.me/customers/v1/app-user-id/${ONBOARDING_ID}`,
      'POST https://auth.sandbox.sa.leantech.me/oauth2/token',
    ]);
    expect(calls()[2].body).toContain(`scope=customer.${CUSTOMER_ID}`);
    expect(calls()[0].body).toContain('scope=api');
  });

  it('creates the customer when Lean has none for the onboarding', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(200, { access_token: 'api-token' }))
      .mockResolvedValueOnce(json(404, { status: 'UNKNOWN_APP_USER' }))
      .mockResolvedValueOnce(json(201, { customer_id: CUSTOMER_ID, app_user_id: ONBOARDING_ID }))
      .mockResolvedValueOnce(json(200, { access_token: 'customer-token' }));

    const link = await service().createLink(ONBOARDING_ID, REDIRECTS);

    expect(link.customerId).toBe(CUSTOMER_ID);
    expect(calls()[2]).toEqual({
      method: 'POST',
      url: 'https://sandbox.sa.leantech.me/customers/v1',
      body: JSON.stringify({ app_user_id: ONBOARDING_ID }),
    });
  });

  it('looks the customer up again when a concurrent create won the race', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(200, { access_token: 'api-token' }))
      .mockResolvedValueOnce(json(404, { status: 'UNKNOWN_APP_USER' }))
      .mockResolvedValueOnce(json(409, { status: 'DUPLICATE' }))
      .mockResolvedValueOnce(json(200, { customer_id: CUSTOMER_ID }))
      .mockResolvedValueOnce(json(200, { access_token: 'customer-token' }));

    await expect(service().createLink(ONBOARDING_ID, REDIRECTS)).resolves.toMatchObject({
      customerId: CUSTOMER_ID,
    });
  });

  it.each([
    ['refused token', [json(401, { error: 'invalid_client' })]],
    [
      'refused customer lookup',
      [json(200, { access_token: 'api-token' }), json(403, { status: 'FORBIDDEN' })],
    ],
    [
      'refused create with no customer after it',
      [
        json(200, { access_token: 'api-token' }),
        json(404, {}),
        json(400, { status: 'INVALID_PARAMETERS' }),
        json(404, {}),
      ],
    ],
  ])('answers 502 LEAN_UNAVAILABLE on a %s', async (_label, responses) => {
    for (const response of responses) {
      fetchSpy.mockResolvedValueOnce(response);
    }

    await expect(service().createLink(ONBOARDING_ID, REDIRECTS)).rejects.toMatchObject({
      status: 502,
      response: { code: 'LEAN_UNAVAILABLE' },
    });
  });

  it('answers 502 LEAN_UNAVAILABLE when Lean is unreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(service().createLink(ONBOARDING_ID, REDIRECTS)).rejects.toMatchObject({
      response: { code: 'LEAN_UNAVAILABLE' },
    });
  });
});
