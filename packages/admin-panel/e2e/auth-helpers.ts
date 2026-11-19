import { expect, type Page } from '@playwright/test';

export const APP_URL = process.env.BASE_URL || 'http://localhost:5174';
export const ENGINE_ONBOARDINGS_ROUTE = '**/v1/onboardings**';

/**
 * Accounts and codes the fake engine in `test-engine-fixture.cjs` accepts. Kept in step by hand:
 * the fixture is CommonJS and cannot be imported here.
 */
export const OPERATOR_EMAIL = 'operator@example.com';
export const ENROLLING_EMAIL = 'enrolling@example.com';
export const VIEWER_EMAIL = 'viewer@example.com';
export const PASSWORD = 'correct-horse-battery';
export const TOTP_CODE = '123456';
export const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

export async function submitCredentials(page: Page, email: string, password: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

export async function submitTwoFactorCode(page: Page, code: string) {
  await page.getByLabel('Authenticator code').fill(code);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
}

/** Signs an account that has two-factor enrolled in through the password and TOTP steps. */
export async function signInWithTwoFactor(page: Page, email: string) {
  await page.goto(APP_URL);
  await submitCredentials(page, email, PASSWORD);
  await expect(page.getByRole('heading', { name: 'Two-factor verification' })).toBeVisible();
  await submitTwoFactorCode(page, TOTP_CODE);
}
