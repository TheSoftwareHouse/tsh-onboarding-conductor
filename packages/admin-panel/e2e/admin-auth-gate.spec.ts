import { expect, test } from '@playwright/test';
import {
  APP_URL,
  ENGINE_ONBOARDINGS_ROUTE,
  ENROLLING_EMAIL,
  OPERATOR_EMAIL,
  PASSWORD,
  TOTP_CODE,
  TOTP_SECRET,
  signInWithTwoFactor,
  submitCredentials,
  submitTwoFactorCode,
} from './auth-helpers';

test.describe('admin panel sign-in gate @auth-enabled', () => {
  test('should withhold the onboarding table until an operator signs in', async ({ page }) => {
    let engineRequests = 0;
    await page.route(ENGINE_ONBOARDINGS_ROUTE, async (route) => {
      engineRequests += 1;
      await route.continue();
    });

    await page.goto(APP_URL);

    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    expect(engineRequests).toBe(0);
  });

  test('should not reveal the session bar or filters before sign-in', async ({ page }) => {
    await page.goto(APP_URL);

    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0);
  });

  test('should offer no Microsoft sign-in unless the engine enables it', async ({ page }) => {
    await page.goto(APP_URL);

    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toHaveCount(0);
  });

  test('should explain a wrong password without starting a session', async ({ page }) => {
    await page.goto(APP_URL);

    await submitCredentials(page, OPERATOR_EMAIL, 'not-the-password');

    await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('should ask for the authenticator code after the password and reject a wrong one', async ({
    page,
  }) => {
    await page.goto(APP_URL);

    await submitCredentials(page, OPERATOR_EMAIL, PASSWORD);

    await expect(page.getByRole('heading', { name: 'Two-factor verification' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);

    await submitTwoFactorCode(page, '000000');

    await expect(page.getByRole('alert')).toHaveText('Invalid code');
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('should show the onboarding table and the signed-in email after the code is accepted', async ({
    page,
  }) => {
    await signInWithTwoFactor(page, OPERATOR_EMAIL);

    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText(OPERATOR_EMAIL)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('should keep the operator signed in across a reload', async ({ page }) => {
    await signInWithTwoFactor(page, OPERATOR_EMAIL);
    await expect(page.getByRole('table')).toBeVisible();

    await page.reload();

    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
  });

  test('should return to the sign-in form after signing out', async ({ page }) => {
    await signInWithTwoFactor(page, OPERATOR_EMAIL);
    await expect(page.getByRole('table')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('should return to the sign-in form when the engine answers 401 for a lost session', async ({
    context,
    page,
  }) => {
    await signInWithTwoFactor(page, OPERATOR_EMAIL);
    await expect(page.getByRole('table')).toBeVisible();

    // The session ends outside the panel (expired or revoked); the next read is what notices.
    await context.clearCookies();
    await page.getByRole('button', { name: 'Reload' }).click();

    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('should let an account without a second factor in, and turn it on and off from Account', async ({
    page,
  }) => {
    await page.goto(APP_URL);

    await submitCredentials(page, ENROLLING_EMAIL, PASSWORD);

    await expect(page.getByRole('table')).toBeVisible();

    await page.getByRole('link', { name: 'Account' }).click();
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText(TOTP_SECRET)).toBeVisible();

    await page.getByLabel('Code from your app').fill(TOTP_CODE);
    await page.getByRole('button', { name: 'Verify and enable' }).click();

    await expect(
      page.getByRole('list', { name: 'Backup codes' }).getByRole('listitem'),
    ).toHaveCount(4);
    await page.getByRole('button', { name: 'I have saved my backup codes' }).click();

    await expect(page.getByText(/^On\./)).toBeVisible();

    await page.getByRole('button', { name: 'Turn off' }).click();
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Turn off' }).click();

    await expect(page.getByText(/^Off\./)).toBeVisible();
  });
});
