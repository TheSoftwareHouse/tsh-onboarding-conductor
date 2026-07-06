import { expect, test } from '@playwright/test';

test('should render placeholder content when the Playwright browser pipeline runs', async ({
  page,
}) => {
  await page.setContent(`
    <main>
      <h1>Demo web Playwright skeleton is ready</h1>
    </main>
  `);

  await expect(
    page.getByRole('heading', { name: 'Demo web Playwright skeleton is ready' }),
  ).toBeVisible();
});
