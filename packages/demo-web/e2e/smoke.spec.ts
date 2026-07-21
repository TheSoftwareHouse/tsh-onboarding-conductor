import { expect, test } from '@playwright/test';

test('should complete the invalid then valid onboarding journey when the demo stack is running', async ({
  page,
}) => {
  const bffOrigin = new URL('http://localhost:3001').origin;
  const apiRequests: string[] = [];

  page.on('request', (request) => {
    if (request.url().includes('/v1/')) {
      apiRequests.push(request.url());
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Onboarding demo' })).toBeVisible();

  await page.getByRole('button', { name: 'Start onboarding' }).click();

  await expect(page.getByRole('heading', { name: 'Onboarding status' })).toBeVisible();
  await expect(page.getByText('Collect Contact', { exact: true })).toBeVisible();

  const email = page.getByLabel(/Email/i);
  const phone = page.getByLabel(/Phone/i);
  const acceptedTerms = page.getByLabel(/Accepted Terms/i);
  const privacyAcknowledged = page.getByLabel(/Privacy Acknowledged/i);
  const marketingConsent = page.getByLabel(/Marketing Consent/i);

  await email.fill('not-an-email');
  await phone.fill('+15550100200');
  await acceptedTerms.check();
  await privacyAcknowledged.check();
  await expect(marketingConsent).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(page.getByText('This value is not in a valid format.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Onboarding status' })).toBeVisible();
  await expect(page.getByText('Collect Contact', { exact: true })).toBeVisible();

  await email.fill('person@example.com');
  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(page.getByRole('status')).toContainText('Your onboarding is approved.');
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();

  const historySummary = page.locator('summary', { hasText: /Journey history \(2\)/i });
  await expect(historySummary).toBeVisible();
  await historySummary.click();

  await expect(page.getByText('Correction needed')).toBeVisible();
  await expect(page.getByText('Step completed')).toBeVisible();
  await expect(page.getByText(/Rejected fields:.*email.*INVALID_FORMAT/i)).toBeVisible();

  const apiOrigins = [...new Set(apiRequests.map((url) => new URL(url).origin))];

  expect(apiOrigins).toEqual([bffOrigin]);
  expect(apiRequests.some((url) => url.includes(':3000/'))).toBeFalsy();
});
