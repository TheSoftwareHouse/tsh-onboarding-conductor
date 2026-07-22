import { expect, test, type Page } from '@playwright/test';

const APP_URL = process.env.BASE_URL || 'http://localhost:5173';
const ENGINE_BASE_URL = process.env.VITE_ENGINE_BASE_URL;
const ENGINE_ONBOARDINGS_PATH = '/v1/admin/onboardings';

if (!ENGINE_BASE_URL) {
  throw new Error('VITE_ENGINE_BASE_URL must be provided to the admin-panel Playwright suite.');
}

const ENGINE_ORIGIN = new URL(ENGINE_BASE_URL).origin;
const ENGINE_ONBOARDINGS_URL = `${ENGINE_ORIGIN}${ENGINE_ONBOARDINGS_PATH}`;

type AdminOnboardingStatus = 'awaiting_user' | 'approved';

type Filters = {
  status: '' | AdminOnboardingStatus;
  workflowId: string;
  workflowVersion: string;
  currentStep: string;
  onboardingId: string;
};

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
}

type EngineRequestRecord = {
  method: string;
  url: string;
  pathname: string;
  search: string;
};

type EngineResponseRecord = {
  url: string;
  status: number;
};

function createTrafficLog(page: Page) {
  const requests: EngineRequestRecord[] = [];
  const responses: EngineResponseRecord[] = [];
  const unexpectedRequests: string[] = [];

  page.on('request', (request) => {
    const url = new URL(request.url());

    if (url.origin !== ENGINE_ORIGIN) {
      return;
    }

    const record = {
      method: request.method(),
      url: request.url(),
      pathname: url.pathname,
      search: url.search,
    };

    requests.push(record);

    if (record.pathname !== ENGINE_ONBOARDINGS_PATH || record.search !== '') {
      unexpectedRequests.push(record.url);
    }
  });

  page.on('response', (response) => {
    const url = new URL(response.url());

    if (
      url.origin !== ENGINE_ORIGIN ||
      url.pathname !== ENGINE_ONBOARDINGS_PATH ||
      url.search !== ''
    ) {
      return;
    }

    responses.push({ url: response.url(), status: response.status() });
  });

  return {
    requests,
    responses,
    unexpectedRequests,
  };
}

test.describe.serial('admin onboardings', () => {
  test('should render lifecycle-safe fields from the direct engine origin', async ({ page }) => {
    const app = new AdminOnboardingsPage(page);
    const traffic = createTrafficLog(page);

    await app.goto();
    await expect(app.statusRegion).toHaveText('Loading onboardings…');
    await expect.poll(() => traffic.requests.length).toBe(2);
    await expect.poll(() => traffic.responses.length).toBe(2);

    await expect(app.heading).toBeVisible();
    await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings.');
    await expect(app.table).toBeVisible();
    await expect(app.table).toContainText('kyc-basic');
    await expect(app.table).toContainText('collect-documents');
    await expect(app.table).toContainText('1 Jul 2026');
    await expect(app.table).toContainText('-');
    await expect(app.table).not.toContainText('fixture-context-row-one');
    expect(traffic.requests).toEqual([
      {
        method: 'GET',
        url: ENGINE_ONBOARDINGS_URL,
        pathname: ENGINE_ONBOARDINGS_PATH,
        search: '',
      },
      {
        method: 'GET',
        url: ENGINE_ONBOARDINGS_URL,
        pathname: ENGINE_ONBOARDINGS_PATH,
        search: '',
      },
    ]);
    expect(traffic.responses).toEqual([
      {
        url: ENGINE_ONBOARDINGS_URL,
        status: 200,
      },
      {
        url: ENGINE_ONBOARDINGS_URL,
        status: 200,
      },
    ]);
    expect(traffic.unexpectedRequests).toEqual([]);
    await expect(page.getByText('fixture-context-row-one')).toHaveCount(0);
  });

  test('should render the accessible list, local filters, and scroll containment without extra engine requests', async ({
    page,
  }) => {
    const app = new AdminOnboardingsPage(page);
    const traffic = createTrafficLog(page);

    await app.goto();
    await expect(app.statusRegion).toHaveText('Loading onboardings…');
    await expect.poll(() => traffic.requests.length).toBe(2);
    await expect.poll(() => traffic.responses.length).toBe(2);

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
    await expect(app.table).not.toContainText('fixture-context-row-one');

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
    expect(wrapperMetrics.scrollHeight).toBeLessThanOrEqual(wrapperMetrics.clientHeight + 1);
    expect(wrapperMetrics.bottom).toBeLessThan(600);

    const pageMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(pageMetrics.scrollWidth).toBeLessThanOrEqual(pageMetrics.clientWidth);
    expect(traffic.requests).toHaveLength(2);
    expect(traffic.responses).toHaveLength(2);
    expect(traffic.unexpectedRequests).toEqual([]);

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
    expect(traffic.requests).toHaveLength(2);
    expect(traffic.responses).toHaveLength(2);
    await expect(page.getByText('fixture-context-row-one')).toHaveCount(0);
  });

  test('should bound the table wrapper to the viewport and scroll internally for a long result set', async ({
    page,
  }) => {
    const app = new AdminOnboardingsPage(page);
    const traffic = createTrafficLog(page);

    await app.goto();
    await expect(app.statusRegion).toHaveText('Loading onboardings…');
    await expect.poll(() => traffic.requests.length).toBe(2);
    await expect.poll(() => traffic.responses.length).toBe(2);

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

    expect(wrapperMetrics.overflowY).toBe('auto');
    expect(wrapperMetrics.scrollHeight).toBeGreaterThan(wrapperMetrics.clientHeight);
    expect(wrapperMetrics.bottom).toBeLessThanOrEqual(720);

    const pageMetrics = await page.evaluate(() => ({
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));

    expect(pageMetrics.scrollHeight).toBeLessThanOrEqual(pageMetrics.clientHeight);
    expect(traffic.requests).toHaveLength(2);
    expect(traffic.responses).toHaveLength(2);
    expect(traffic.unexpectedRequests).toEqual([]);
  });

  test('should show loading, error, and reload recovery states without extra engine requests on filter changes', async ({
    page,
  }) => {
    const app = new AdminOnboardingsPage(page);
    const traffic = createTrafficLog(page);

    await app.goto();
    await expect(app.statusRegion).toHaveText('Loading onboardings…');
    await expect.poll(() => traffic.requests.length).toBe(2);
    await expect.poll(() => traffic.responses.length).toBe(2);

    await expect(app.statusRegion).toHaveText(
      'Unable to load onboardings: Request failed with status 500.',
    );
    await expect(app.table).toHaveCount(0);
    expect(traffic.responses).toEqual([
      { url: ENGINE_ONBOARDINGS_URL, status: 500 },
      { url: ENGINE_ONBOARDINGS_URL, status: 500 },
    ]);

    await app.reload();
    await expect(app.statusRegion).toHaveText('Loading onboardings…');
    await expect.poll(() => traffic.requests.length).toBe(3);
    await expect.poll(() => traffic.responses.length).toBe(3);
    await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings.');
    await expect(app.table).toContainText('kyc-reloaded');
    await expect(app.table).toContainText('final-review');
    await expect(app.table).toContainText('9 Jul 2026');

    await app.fillFilters({ workflowId: 'kyc-reloaded' });
    await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings.');

    expect(traffic.requests).toEqual([
      {
        method: 'GET',
        url: ENGINE_ONBOARDINGS_URL,
        pathname: ENGINE_ONBOARDINGS_PATH,
        search: '',
      },
      {
        method: 'GET',
        url: ENGINE_ONBOARDINGS_URL,
        pathname: ENGINE_ONBOARDINGS_PATH,
        search: '',
      },
      {
        method: 'GET',
        url: ENGINE_ONBOARDINGS_URL,
        pathname: ENGINE_ONBOARDINGS_PATH,
        search: '',
      },
    ]);
    expect(traffic.responses).toEqual([
      {
        url: ENGINE_ONBOARDINGS_URL,
        status: 500,
      },
      {
        url: ENGINE_ONBOARDINGS_URL,
        status: 500,
      },
      {
        url: ENGINE_ONBOARDINGS_URL,
        status: 200,
      },
    ]);
    expect(traffic.unexpectedRequests).toEqual([]);
    await expect(page.getByText('fixture-context-row-four')).toHaveCount(0);
  });
});
