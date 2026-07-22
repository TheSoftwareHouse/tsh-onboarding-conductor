import { expect, test, type Page } from '@playwright/test';

const APP_URL = process.env.BASE_URL || 'http://localhost:5173';

type AdminOnboardingStatus = 'awaiting_user' | 'approved';

interface AdminOnboardingSummary {
  onboardingId: string;
  workflowId: string;
  workflowVersion: number;
  status: AdminOnboardingStatus;
  currentStep: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  context?: unknown;
}

type Filters = {
  status: '' | AdminOnboardingStatus;
  workflowId: string;
  workflowVersion: string;
  currentStep: string;
  onboardingId: string;
};

const FILTER_FIXTURE: AdminOnboardingSummary[] = [
  {
    onboardingId: '018f1e2a-1111-7000-8000-000000000001',
    workflowId: 'kyc-basic',
    workflowVersion: 1,
    status: 'awaiting_user',
    currentStep: 'collect-documents',
    expiresAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    completedAt: null,
    context: { hidden: 'row-one' },
  },
  {
    onboardingId: '018F1E2A-2222-7000-8000-000000000002',
    workflowId: 'kyc-basic',
    workflowVersion: 2,
    status: 'approved',
    currentStep: null,
    expiresAt: null,
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
    completedAt: '2026-07-05T00:00:00.000Z',
    context: { hidden: 'row-two' },
  },
  {
    onboardingId: '018f1e2a-3333-7000-8000-000000000003',
    workflowId: 'kyc-enhanced-with-an-excessively-long-workflow-identifier-for-scroll-testing',
    workflowVersion: 3,
    status: 'awaiting_user',
    currentStep: 'collect-documents-with-a-long-step-name-to-force-table-overflow',
    expiresAt: '2026-08-02T00:00:00.000Z',
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    completedAt: null,
    context: { hidden: 'row-three' },
  },
];

const RELOAD_FIXTURE: AdminOnboardingSummary[] = [
  {
    onboardingId: '018f1e2a-4444-7000-8000-000000000004',
    workflowId: 'kyc-reloaded',
    workflowVersion: 4,
    status: 'approved',
    currentStep: 'final-review',
    expiresAt: '2026-08-03T00:00:00.000Z',
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
    completedAt: '2026-07-09T00:00:00.000Z',
    context: { hidden: 'reload-row' },
  },
];

class AdminOnboardingsPage {
  constructor(readonly page: Page) {}

  get heading() {
    return this.page.getByRole('heading', { name: 'Admin onboardings' });
  }

  get statusRegion() {
    return this.page.getByRole('status');
  }

  get table() {
    return this.page.getByRole('table', { name: 'Onboardings matching the current filters' });
  }

  get tableRegion() {
    return this.page.getByRole('region', { name: 'Onboardings results' });
  }

  get tableCaption() {
    return this.page.locator('caption', { hasText: 'Onboardings matching the current filters' });
  }

  get statusFilter() {
    return this.page.getByLabel('Status');
  }

  get workflowIdFilter() {
    return this.page.getByLabel('Workflow ID');
  }

  get workflowVersionFilter() {
    return this.page.getByLabel('Workflow version');
  }

  get currentStepFilter() {
    return this.page.getByLabel('Current step');
  }

  get onboardingIdFilter() {
    return this.page.getByLabel('Onboarding ID');
  }

  get reloadButton() {
    return this.page.getByRole('button', { name: 'Reload' });
  }

  get resetButton() {
    return this.page.getByRole('button', { name: 'Reset filters' });
  }

  columnHeader(name: string) {
    return this.page.getByRole('columnheader', { name });
  }

  async goto() {
    await this.page.goto(APP_URL);
  }

  async fillFilters(filters: Partial<Filters>) {
    if (filters.status !== undefined) {
      await this.statusFilter.selectOption(filters.status);
    }

    if (filters.workflowId !== undefined) {
      await this.workflowIdFilter.fill(filters.workflowId);
    }

    if (filters.workflowVersion !== undefined) {
      await this.workflowVersionFilter.fill(filters.workflowVersion);
    }

    if (filters.currentStep !== undefined) {
      await this.currentStepFilter.fill(filters.currentStep);
    }

    if (filters.onboardingId !== undefined) {
      await this.onboardingIdFilter.fill(filters.onboardingId);
    }
  }

  async resetFilters() {
    await this.resetButton.click();
  }

  async reload() {
    await this.reloadButton.click();
  }

  async tabThrough(times: number) {
    for (let index = 0; index < times; index += 1) {
      await this.page.keyboard.press('Tab');
    }
  }
}

async function interceptOnboardings(page: Page, response: AdminOnboardingSummary[] | null) {
  let requestCount = 0;
  let release: (() => void) | null = null;

  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('**/api/v1/admin/onboardings', async (route) => {
    requestCount += 1;
    await ready;

    if (response === null) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'boom' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  return {
    requestCount: () => requestCount,
    release: () => {
      if (release) {
        release();
      }
    },
  };
}

test('should render the proxied fixture through the Vite rewrite without interception', async ({
  page,
}) => {
  const app = new AdminOnboardingsPage(page);

  await app.goto();

  await expect(app.heading).toBeVisible();
  await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings.');
  await expect(app.table).toBeVisible();
  await expect(app.table).toContainText('kyc-basic');
  await expect(app.table).toContainText('collect-documents');
  await expect(app.table).toContainText('1 Jul 2026');
  await expect(app.table).toContainText('-');
  await expect(app.table).not.toContainText('proxy fixture context');
});

test('should render the accessible list, local filters, and scroll containment without extra requests', async ({
  page,
}) => {
  const app = new AdminOnboardingsPage(page);
  const api = await interceptOnboardings(page, FILTER_FIXTURE);

  await app.goto();
  await expect(app.statusRegion).toHaveText('Loading onboardings…');
  api.release();

  await expect(app.statusRegion).toHaveText('Showing 3 of 3 onboardings.');
  await expect(app.table).toBeVisible();
  await expect(app.tableCaption).toHaveText('Onboardings matching the current filters');
  const captionBox = await app.tableCaption.evaluate((caption) => {
    const rect = caption.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(captionBox.width).toBeLessThanOrEqual(1);
  expect(captionBox.height).toBeLessThanOrEqual(1);
  await expect(app.columnHeader('Onboarding ID')).toBeVisible();
  await expect(app.columnHeader('Workflow ID')).toBeVisible();
  await expect(app.columnHeader('Workflow version')).toBeVisible();
  await expect(app.columnHeader('Status')).toBeVisible();
  await expect(app.columnHeader('Current step')).toBeVisible();
  await expect(app.columnHeader('Expires at')).toBeVisible();
  await expect(app.columnHeader('Created at')).toBeVisible();
  await expect(app.columnHeader('Updated at')).toBeVisible();
  await expect(app.columnHeader('Completed at')).toBeVisible();
  await expect(app.table).toContainText(
    'kyc-enhanced-with-an-excessively-long-workflow-identifier-for-scroll-testing',
  );
  await expect(app.table).toContainText(
    'collect-documents-with-a-long-step-name-to-force-table-overflow',
  );
  await expect(app.table).toContainText('-');
  await expect(app.table).not.toContainText('row-one');

  await app.fillFilters({ status: 'approved' });
  await expect(app.statusRegion).toHaveText('Showing 1 of 3 onboardings.');
  await expect(app.table).toContainText('018F1E2A-2222-7000-8000-000000000002');

  await app.resetFilters();
  await expect(app.statusRegion).toHaveText('Showing 3 of 3 onboardings.');

  await app.fillFilters({ workflowId: 'kyc-basic' });
  await expect(app.statusRegion).toHaveText('Showing 2 of 3 onboardings.');

  await app.resetFilters();
  await app.fillFilters({ workflowVersion: '3' });
  await expect(app.statusRegion).toHaveText('Showing 1 of 3 onboardings.');

  await app.resetFilters();
  await app.fillFilters({ currentStep: 'collect-documents' });
  await expect(app.statusRegion).toHaveText('Showing 1 of 3 onboardings.');

  await app.resetFilters();
  await app.fillFilters({ onboardingId: '018F1E2A-2222-7000-8000-000000000002' });
  await expect(app.statusRegion).toHaveText('Showing 1 of 3 onboardings.');

  await app.resetFilters();
  await app.fillFilters({
    status: 'awaiting_user',
    workflowId: 'kyc-basic',
    workflowVersion: '1',
    currentStep: 'collect-documents',
    onboardingId: '018f1e2a-1111-7000-8000-000000000001',
  });
  await expect(app.statusRegion).toHaveText('Showing 1 of 3 onboardings.');

  await app.resetFilters();
  await app.fillFilters({ workflowId: 'does-not-match' });
  await expect(app.statusRegion).toHaveText('No onboardings match the current filters.');
  await expect(app.table).toContainText('No onboardings match the current filters.');

  await app.resetFilters();
  await expect(app.statusRegion).toHaveText('Showing 3 of 3 onboardings.');

  await expect(app.tableRegion).toHaveAttribute('aria-label', 'Onboardings results');
  const wrapperMetrics = await app.tableRegion.evaluate((region) => {
    const wrapper = region as HTMLElement;
    return {
      overflowX: getComputedStyle(wrapper).overflowX,
      overflowY: getComputedStyle(wrapper).overflowY,
      clientWidth: wrapper.clientWidth,
      scrollWidth: wrapper.scrollWidth,
      clientHeight: wrapper.clientHeight,
      scrollHeight: wrapper.scrollHeight,
      bottom: wrapper.getBoundingClientRect().bottom,
    };
  });

  expect(wrapperMetrics.overflowX).toBe('auto');
  expect(wrapperMetrics.overflowY).toBe('auto');
  expect(wrapperMetrics.scrollWidth).toBeGreaterThan(wrapperMetrics.clientWidth);

  // Regression: a short result set must size the wrapper to its content instead of
  // stretching to fill the remaining page height.
  expect(wrapperMetrics.scrollHeight).toBeLessThanOrEqual(wrapperMetrics.clientHeight + 1);
  expect(wrapperMetrics.bottom).toBeLessThan(600);

  const pageMetrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(pageMetrics.scrollWidth).toBeLessThanOrEqual(pageMetrics.clientWidth);
  expect(api.requestCount()).toBe(1);

  await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur();
  });

  for (let index = 0; index < 15; index += 1) {
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      return {
        tagName: element?.tagName ?? null,
        text: element?.textContent?.trim() ?? null,
      };
    });

    if (active.tagName === 'BUTTON' && active.text === 'Reset filters') {
      break;
    }
  }

  const focusedText = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) {
      return null;
    }

    const style = getComputedStyle(active);
    return {
      tagName: active.tagName,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      text: active.textContent,
    };
  });

  expect(focusedText).not.toBeNull();
  expect(focusedText?.tagName).toBe('BUTTON');
  expect(focusedText?.text).toBe('Reset filters');
  expect(focusedText?.outlineStyle).not.toBe('none');
  expect(Number.parseFloat(focusedText?.outlineWidth ?? '0')).toBeGreaterThan(0);

  await page.keyboard.press('Space');
  await expect(app.statusRegion).toHaveText('Showing 3 of 3 onboardings.');
  expect(api.requestCount()).toBe(1);
  await expect(page.getByText('proxy fixture context')).toHaveCount(0);
});

test('should bound the table wrapper to the viewport and scroll internally for a long result set', async ({
  page,
}) => {
  const app = new AdminOnboardingsPage(page);
  const longFixture: AdminOnboardingSummary[] = Array.from({ length: 40 }, (_, index) => ({
    onboardingId: `018f1e2a-${String(index).padStart(4, '0')}-7000-8000-00000000${String(index).padStart(4, '0')}`,
    workflowId: 'kyc-basic',
    workflowVersion: 1,
    status: index % 2 === 0 ? 'awaiting_user' : 'approved',
    currentStep: 'collect-documents',
    expiresAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    completedAt: null,
  }));
  const api = await interceptOnboardings(page, longFixture);

  await app.goto();
  api.release();

  await expect(app.statusRegion).toHaveText('Showing 40 of 40 onboardings.');
  await expect(app.table).toBeVisible();

  const wrapperMetrics = await app.tableRegion.evaluate((region) => {
    const wrapper = region as HTMLElement;
    return {
      overflowY: getComputedStyle(wrapper).overflowY,
      clientHeight: wrapper.clientHeight,
      scrollHeight: wrapper.scrollHeight,
      bottom: wrapper.getBoundingClientRect().bottom,
    };
  });

  // Regression: a long result set must be bounded to the viewport and scroll
  // internally instead of growing the wrapper (and the page) past the fold.
  expect(wrapperMetrics.overflowY).toBe('auto');
  expect(wrapperMetrics.scrollHeight).toBeGreaterThan(wrapperMetrics.clientHeight);
  expect(wrapperMetrics.bottom).toBeLessThanOrEqual(720);

  const pageMetrics = await page.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));

  expect(pageMetrics.scrollHeight).toBeLessThanOrEqual(pageMetrics.clientHeight);
});

test('should show loading, error, and reload recovery states without an extra request on filter changes', async ({
  page,
}) => {
  const app = new AdminOnboardingsPage(page);
  let requestIndex = 0;

  await page.route('**/api/v1/admin/onboardings', async (route) => {
    requestIndex += 1;

    if (requestIndex === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'upstream unavailable' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(RELOAD_FIXTURE),
    });
  });

  await app.goto();
  await expect(app.statusRegion).toHaveText(
    'Unable to load onboardings: Request failed with status 500.',
  );
  await expect(app.table).toHaveCount(0);

  await app.reload();
  await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings.');
  await expect(app.table).toContainText('kyc-reloaded');
  await expect(app.table).toContainText('final-review');
  await expect(app.table).toContainText('9 Jul 2026');

  await app.fillFilters({ workflowId: 'kyc-reloaded' });
  await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings.');
  expect(requestIndex).toBe(2);
});
