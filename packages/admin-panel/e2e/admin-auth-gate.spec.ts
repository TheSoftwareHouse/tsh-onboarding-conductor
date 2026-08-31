import { expect, test, type Page } from '@playwright/test';

const APP_URL = process.env.BASE_URL || 'http://localhost:5174';
const ENGINE_ONBOARDINGS_ROUTE = '**/v1/onboardings**';
const ENTRA_ROUTE = 'https://login.microsoftonline.com/**';
const TENANT_ID = '00000000-0000-0000-0000-0000000000e1';
const CLIENT_ID = '00000000-0000-0000-0000-0000000000c1';
const API_SCOPE = '00000000-0000-0000-0000-0000000000c1/.default';

/**
 * Keeps the run offline. MSAL may resolve authority metadata before it will build an authorize
 * URL, and a suite that reaches the real login.microsoftonline.com would be neither hermetic nor
 * reliable in CI.
 */
async function stubEntraDiscovery(page: Page): Promise<string[]> {
  const authorizeRequests: string[] = [];

  await page.route(ENTRA_ROUTE, async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname.endsWith('/v2.0/.well-known/openid-configuration')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
          authorization_endpoint: `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`,
          token_endpoint: `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
          end_session_endpoint: `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/logout`,
          jwks_uri: `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`,
          response_modes_supported: ['query', 'fragment', 'form_post'],
          subject_types_supported: ['pairwise'],
          id_token_signing_alg_values_supported: ['RS256'],
        }),
      });

      return;
    }

    if (url.pathname.includes('/oauth2/v2.0/authorize')) {
      // Capture the redirect the panel wanted to make, then stop it: following it would leave the
      // app and there is no directory on the other end.
      authorizeRequests.push(route.request().url());
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });

      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return authorizeRequests;
}

test.describe('admin panel sign-in gate @auth-enabled', () => {
  test('should withhold the onboarding table until an operator signs in', async ({ page }) => {
    await stubEntraDiscovery(page);
    let engineRequests = 0;
    await page.route(ENGINE_ONBOARDINGS_ROUTE, async (route) => {
      engineRequests += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto(APP_URL);

    await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    expect(engineRequests).toBe(0);
  });

  test('should not reveal the session bar or filters before sign-in', async ({ page }) => {
    await stubEntraDiscovery(page);

    await page.goto(APP_URL);

    await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0);
  });

  test('should start an authorization-code flow with PKCE and no client secret', async ({
    page,
  }) => {
    // The panel is a browser public client. If it ever asked for a token by any other grant, or
    // dropped the PKCE challenge, the whole no-secret posture would be wrong.
    const authorizeRequests = await stubEntraDiscovery(page);

    await page.goto(APP_URL);
    await page.getByRole('button', { name: 'Sign in with Microsoft' }).click();

    await expect.poll(() => authorizeRequests.length).toBeGreaterThan(0);

    const authorizeUrl = new URL(authorizeRequests[0]);
    expect(authorizeUrl.pathname).toContain(`/${TENANT_ID}/oauth2/v2.0/authorize`);
    expect(authorizeUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorizeUrl.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(authorizeUrl.searchParams.get('client_secret')).toBeNull();
  });

  test('should ask for the engine scope during sign-in so the first read needs no second prompt', async ({
    page,
  }) => {
    const authorizeRequests = await stubEntraDiscovery(page);

    await page.goto(APP_URL);
    await page.getByRole('button', { name: 'Sign in with Microsoft' }).click();

    await expect.poll(() => authorizeRequests.length).toBeGreaterThan(0);

    const scope = new URL(authorizeRequests[0]).searchParams.get('scope') ?? '';
    expect(scope).toContain(API_SCOPE);
  });

  test('should redirect back to the origin the panel is served from', async ({ page }) => {
    const authorizeRequests = await stubEntraDiscovery(page);

    await page.goto(APP_URL);
    await page.getByRole('button', { name: 'Sign in with Microsoft' }).click();

    await expect.poll(() => authorizeRequests.length).toBeGreaterThan(0);

    const redirectUri = new URL(authorizeRequests[0]).searchParams.get('redirect_uri');
    expect(redirectUri).toBe(APP_URL);
  });
});
