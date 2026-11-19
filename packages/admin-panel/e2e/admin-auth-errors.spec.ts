import { expect, test, type Page } from '@playwright/test';
import {
  APP_URL,
  ENGINE_ONBOARDINGS_ROUTE,
  OPERATOR_EMAIL,
  VIEWER_EMAIL,
  signInWithTwoFactor,
} from './auth-helpers';

/**
 * What the operator is told when the engine refuses an admin request. Each status calls for a
 * different next step — sign in again, ask for a role, or simply wait — and getting these wrong
 * sends someone chasing their own session over an engine-side fault.
 *
 * The panel is signed in through the fake engine's real cookie flow; the 401 and 503 refusals are
 * then injected at the network boundary, because the fake engine only produces them for a missing
 * or unverifiable session, which the gate would already have caught. What is under test is how the
 * panel reports a refusal.
 */
const INJECTED_REFUSALS = [
  {
    status: 401,
    code: 'ADMIN_SESSION_REQUIRED',
    label: 'an expired session',
    message: 'Your session is no longer accepted by the engine. Sign in again.',
  },
  {
    status: 503,
    code: 'ADMIN_VERIFICATION_UNAVAILABLE',
    label: 'an engine that cannot verify sessions',
    message:
      'The sign-in service is unavailable right now. This is not a problem with your account — try again shortly.',
  },
] as const;

const CORS_HEADERS = {
  'access-control-allow-origin': APP_URL,
  'access-control-allow-credentials': 'true',
};

async function respondWith(page: Page, status: number, code: string) {
  await page.route(ENGINE_ONBOARDINGS_ROUTE, async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: CORS_HEADERS,
      body: JSON.stringify({ statusCode: status, code, message: 'refused' }),
    });
  });
}

async function signInAsOperatorThenRefuse(page: Page, status: number, code: string) {
  // Sign in first against the fake engine, then start refusing: the first table load is what the
  // refusal replaces, so it has to be the next onboarding request.
  await signInWithTwoFactor(page, OPERATOR_EMAIL);
  await expect(page.getByRole('table')).toBeVisible();
  await respondWith(page, status, code);
  await page.getByRole('button', { name: 'Reload' }).click();
}

test.describe('admin panel authentication failures @auth-enabled', () => {
  for (const refusal of INJECTED_REFUSALS) {
    test(`should explain a ${refusal.status} from ${refusal.label}`, async ({ page }) => {
      await signInAsOperatorThenRefuse(page, refusal.status, refusal.code);

      await expect(page.getByRole('status')).toHaveText(
        `Unable to load onboardings: ${refusal.message}`,
      );
    });
  }

  test('should not tell an operator to sign in again when the engine is the problem', async ({
    page,
  }) => {
    // The 401/503 distinction only pays off if the 503 message avoids the sign-in advice.
    await signInAsOperatorThenRefuse(page, 503, 'ADMIN_VERIFICATION_UNAVAILABLE');

    const status = page.getByRole('status');
    await expect(status).toContainText('not a problem with your account');
    await expect(status).not.toContainText('Sign in again');
  });

  test('should explain a missing admin permission and show no table', async ({ page }) => {
    // The fake engine answers 403 ADMIN_PERMISSION_MISSING for this account after a full sign-in.
    await signInWithTwoFactor(page, VIEWER_EMAIL);

    await expect(page.getByRole('status')).toHaveText(
      'Unable to load onboardings: Your role in the active organization does not allow viewing onboardings.',
    );
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('should recover once the engine starts accepting the session again', async ({ page }) => {
    // A refusal must not be a terminal state: an operator who is granted a permission mid-session
    // should be able to reload rather than sign in again.
    await signInWithTwoFactor(page, OPERATOR_EMAIL);
    await expect(page.getByRole('table')).toBeVisible();
    await respondWith(page, 403, 'ADMIN_PERMISSION_MISSING');
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(page.getByRole('status')).toContainText('does not allow viewing');

    await page.unroute(ENGINE_ONBOARDINGS_ROUTE);
    await page.getByRole('button', { name: 'Reload' }).click();

    await expect(page.getByRole('table')).toBeVisible();
  });
});
