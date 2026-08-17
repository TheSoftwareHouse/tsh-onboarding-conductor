import { expect, test, type Page } from '@playwright/test';

const APP_URL = process.env.BASE_URL || 'http://localhost:5173';
const ENGINE_ONBOARDINGS_ROUTE = '**/v1/onboardings**';

/**
 * What the operator is told when the engine refuses the request. Each status calls for a
 * different next step — sign in again, ask for a role, or simply wait — and getting these wrong
 * sends someone chasing their own session over an engine-side fault.
 *
 * The suite runs with sign-in disabled, so the refusals are injected at the network boundary
 * rather than produced by Entra. That is deliberate: what is under test is how the panel reports
 * an engine refusal, which is independent of how the token was obtained.
 */
const REFUSALS = [
  {
    status: 401,
    label: 'an expired or unacceptable token',
    message: 'Your session is no longer accepted by the engine. Sign in again.',
  },
  {
    status: 403,
    label: 'an account with no admin role',
    message: 'Your account is signed in but is not assigned a role that may view onboardings.',
  },
  {
    status: 503,
    label: 'an engine that cannot reach Entra',
    message:
      'The engine cannot verify sign-ins right now. This is not a problem with your account — try again shortly.',
  },
] as const;

async function respondWith(page: Page, status: number): Promise<void> {
  await page.route(ENGINE_ONBOARDINGS_ROUTE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': APP_URL,
          'access-control-allow-headers': 'authorization,content-type',
          'access-control-allow-methods': 'GET,OPTIONS',
        },
      });

      return;
    }

    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': APP_URL },
      body: JSON.stringify({ message: 'refused' }),
    });
  });
}

test.describe('admin panel authentication failures', () => {
  for (const refusal of REFUSALS) {
    test(`should explain a ${refusal.status} from ${refusal.label}`, async ({ page }) => {
      await respondWith(page, refusal.status);

      await page.goto(APP_URL);

      await expect(page.getByRole('status')).toHaveText(
        `Unable to load onboardings: ${refusal.message}`,
      );
    });
  }

  test('should not tell an operator to sign in again when the engine is the problem', async ({
    page,
  }) => {
    // The 401/503 distinction only pays off if the 503 message avoids the sign-in advice.
    await respondWith(page, 503);

    await page.goto(APP_URL);

    const status = page.getByRole('status');
    await expect(status).toContainText('not a problem with your account');
    await expect(status).not.toContainText('Sign in again');
  });

  test('should show no onboarding table when the engine refuses the request', async ({ page }) => {
    await respondWith(page, 403);

    await page.goto(APP_URL);

    await expect(page.getByRole('status')).toContainText('not assigned a role');
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('should recover once the engine starts accepting the credential again', async ({ page }) => {
    // A refusal must not be a terminal state: an operator who is granted a role mid-session
    // should be able to reload rather than restart the panel.
    let refuse = true;

    await page.route(ENGINE_ONBOARDINGS_ROUTE, async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': APP_URL,
            'access-control-allow-headers': 'authorization,content-type',
            'access-control-allow-methods': 'GET,OPTIONS',
          },
        });

        return;
      }

      await route.fulfill({
        status: refuse ? 403 : 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': APP_URL },
        body: refuse ? JSON.stringify({ message: 'refused' }) : JSON.stringify([]),
      });
    });

    await page.goto(APP_URL);
    await expect(page.getByRole('status')).toContainText('not assigned a role');

    refuse = false;
    await page.getByRole('button', { name: 'Reload' }).click();

    await expect(page.getByRole('status')).toHaveText('No onboardings were returned.');
  });
});
