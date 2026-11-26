import { expect, test, type Page } from '@playwright/test';
import {
  ENGINE_ONBOARDINGS_ROUTE,
  OPERATOR_EMAIL,
  PASSWORD,
  SWITCHER_EMAIL,
  TOTP_CODE,
  VIEWER_EMAIL,
  signInWithTwoFactor,
  submitCredentials,
  submitTwoFactorCode,
} from './auth-helpers';

const ONBOARDINGS_PATH = '/v1/onboardings';
const WORKFLOWS_PATH = '/v1/admin/workflows';
const EVERY_ONBOARDING = /of 40 onboardings/;
const BETA_ONBOARDINGS = /of 1 onboardings/;

/**
 * The panel never refetches on its own (`refetchOnMount` only for an invalidated query), so a
 * cache that outlived its session would be served as-is to whoever signs in next. Each scenario
 * here proves the data on screen was fetched for the session that is showing it.
 */

/** Counts the GETs the panel sends to one engine path, so a spec can tell a fetch from a cache hit. */
function countReads(page: Page, pathname: string): () => number {
  let count = 0;

  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === pathname) {
      count += 1;
    }
  });

  return () => count;
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
}

async function signInAgain(page: Page, email: string) {
  await submitCredentials(page, email, PASSWORD);
  await expect(page.getByRole('heading', { name: 'Two-factor verification' })).toBeVisible();
  await submitTwoFactorCode(page, TOTP_CODE);
}

async function openSection(page: Page, name: string) {
  await page.getByRole('link', { name, exact: true }).click();
}

async function chooseOrganization(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Organization' }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

test.describe('admin panel session cache @auth-enabled', () => {
  test('should fetch the onboardings again after the same operator signs out and back in', async ({
    page,
  }) => {
    const onboardingReads = countReads(page, ONBOARDINGS_PATH);
    await signInWithTwoFactor(page, OPERATOR_EMAIL);
    await expect(page.getByText(EVERY_ONBOARDING)).toBeVisible();
    const readsBefore = onboardingReads();

    await signOut(page);
    await signInAgain(page, OPERATOR_EMAIL);

    await expect(page.getByText(EVERY_ONBOARDING)).toBeVisible();
    expect(onboardingReads()).toBeGreaterThan(readsBefore);
  });

  test("should not show the previous operator's onboardings to the next one", async ({ page }) => {
    await signInWithTwoFactor(page, OPERATOR_EMAIL);
    await expect(page.getByRole('row')).not.toHaveCount(1);

    await signOut(page);
    await signInAgain(page, VIEWER_EMAIL);

    // The viewer may not read onboardings: what shows is the refusal, not the cached rows.
    await expect(page.getByRole('alert')).toContainText('No access to onboardings');
    await expect(page.getByRole('row')).toHaveCount(1);
  });

  test('should refuse the next operator the page the previous one left open', async ({ page }) => {
    await signInWithTwoFactor(page, OPERATOR_EMAIL);
    await openSection(page, 'Workflows');
    await expect(page.getByRole('row')).not.toHaveCount(1);

    await signOut(page);
    await signInAgain(page, VIEWER_EMAIL);

    // The gate kept the URL: the viewer lands on Workflows and must see the refusal, not rows.
    await expect(page.getByRole('alert')).toContainText('No access to workflows');
    await expect(page.getByRole('row')).toHaveCount(1);
  });

  test('should not serve the next operator a page the previous one visited earlier', async ({
    page,
  }) => {
    await signInWithTwoFactor(page, OPERATOR_EMAIL);
    await openSection(page, 'Workflows');
    await expect(page.getByRole('row')).not.toHaveCount(1);
    await openSection(page, 'Onboardings');
    await expect(page.getByText(EVERY_ONBOARDING)).toBeVisible();

    await signOut(page);
    await signInAgain(page, VIEWER_EMAIL);
    await expect(page.getByRole('alert')).toContainText('No access to onboardings');
    await openSection(page, 'Workflows');

    await expect(page.getByRole('alert')).toContainText('No access to workflows');
    await expect(page.getByRole('row')).toHaveCount(1);
  });

  test('should drop the pages off screen when the engine answers 401 to a live session', async ({
    page,
  }) => {
    const workflowReads = countReads(page, WORKFLOWS_PATH);
    await signInWithTwoFactor(page, OPERATOR_EMAIL);
    await openSection(page, 'Workflows');
    await expect(page.getByRole('row')).not.toHaveCount(1);
    await openSection(page, 'Onboardings');
    await expect(page.getByText(EVERY_ONBOARDING)).toBeVisible();
    const readsBefore = workflowReads();

    await page.route(ENGINE_ONBOARDINGS_ROUTE, (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': new URL(page.url()).origin,
          'access-control-allow-credentials': 'true',
        },
        body: JSON.stringify({
          statusCode: 401,
          code: 'ADMIN_SESSION_REQUIRED',
          message: 'refused',
        }),
      }),
    );
    await page.getByRole('button', { name: 'Reload' }).click();
    // better-auth still holds the session, so the operator stays signed in with the error shown.
    await expect(page.getByRole('alert')).toContainText('Sign in again');
    await page.unroute(ENGINE_ONBOARDINGS_ROUTE);

    await openSection(page, 'Workflows');

    await expect(page.getByRole('row')).not.toHaveCount(1);
    expect(workflowReads()).toBeGreaterThan(readsBefore);
  });

  test('should return to sign-in on a lost session and show the next operator none of its data', async ({
    context,
    page,
  }) => {
    await signInWithTwoFactor(page, OPERATOR_EMAIL);
    await expect(page.getByText(EVERY_ONBOARDING)).toBeVisible();

    await context.clearCookies();
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await signInAgain(page, VIEWER_EMAIL);

    await expect(page.getByRole('alert')).toContainText('No access to onboardings');
    await expect(page.getByRole('row')).toHaveCount(1);
  });

  test('should show each organization its own onboardings when switching', async ({ page }) => {
    const onboardingReads = countReads(page, ONBOARDINGS_PATH);
    await signInWithTwoFactor(page, SWITCHER_EMAIL);
    await expect(page.getByText(EVERY_ONBOARDING)).toBeVisible();

    await chooseOrganization(page, 'Beta');

    await expect(page.getByText(BETA_ONBOARDINGS)).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Organization' })).toHaveText('Beta');
    const readsInBeta = onboardingReads();

    await chooseOrganization(page, 'Alpha');

    // Alpha's list was cached before the switch; it is fetched again rather than served from it.
    await expect(page.getByText(EVERY_ONBOARDING)).toBeVisible();
    expect(onboardingReads()).toBeGreaterThan(readsInBeta);
  });

  test("should not offer the next operator the previous one's organizations", async ({ page }) => {
    await signInWithTwoFactor(page, SWITCHER_EMAIL);
    await expect(page.getByRole('combobox', { name: 'Organization' })).toBeVisible();

    await signOut(page);
    await signInAgain(page, OPERATOR_EMAIL);

    await expect(page.getByText(EVERY_ONBOARDING)).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Organization' })).toHaveCount(0);
  });

  test('should sign every open tab out and clear its data when one tab signs out', async ({
    context,
    page,
  }) => {
    await signInWithTwoFactor(page, OPERATOR_EMAIL);
    await expect(page.getByText(EVERY_ONBOARDING)).toBeVisible();
    const otherTab = await context.newPage();
    await otherTab.goto(page.url());
    await expect(otherTab.getByText(EVERY_ONBOARDING)).toBeVisible();

    await signOut(otherTab);

    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });
});
