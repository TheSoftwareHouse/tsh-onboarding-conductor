import { expect, test } from '@playwright/test';

test('should render the app shell when the demo web is served', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('banner').getByText('BNPL credit check')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Check your credit with open banking' }),
  ).toBeVisible();
});
