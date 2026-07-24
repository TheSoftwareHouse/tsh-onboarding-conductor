import { expect, test, type Page } from '@playwright/test';
import type { AdminOnboardingSummary } from '@/entities/onboarding';

const APP_URL = process.env.BASE_URL || 'http://localhost:5173';
const ENGINE_BASE_URL = process.env.VITE_ENGINE_API_BASE_URL;
const ENGINE_ONBOARDINGS_PATH = '/v1/admin/onboardings';
const ENGINE_ONBOARDINGS_ROUTE = '**/v1/admin/onboardings**';

if (!ENGINE_BASE_URL) {
  throw new Error('VITE_ENGINE_API_BASE_URL must be provided to the admin-panel Playwright suite.');
}

const ENGINE_ORIGIN = new URL(ENGINE_BASE_URL).origin;
const ENGINE_ONBOARDINGS_URL = `${ENGINE_ORIGIN}${ENGINE_ONBOARDINGS_PATH}`;
const SPECIAL_WORKFLOW_ID = 'kyc basic / encoding?';
const SPECIAL_CURRENT_STEP = 'final review / qa?';
const SPECIAL_ONBOARDING_ID = '018f1e2a-eeee-7000-8000-00000000000e';
const SPECIAL_REQUEST_SEARCH =
  '?status=approved&workflowId=kyc+basic+%2F+encoding%3F&workflowVersion=7&currentStep=final+review+%2F+qa%3F&onboardingId=018f1e2a-eeee-7000-8000-00000000000e';
const WORKFLOW_ID_ONLY_SEARCH = '?workflowId=kyc+basic+%2F+encoding%3F';
const STATUS_ONLY_SEARCH = '?status=approved';
const WORKFLOW_VERSION_ONLY_SEARCH = '?workflowVersion=7';
const CURRENT_STEP_ONLY_SEARCH = '?currentStep=final+review+%2F+qa%3F';
const ONBOARDING_ID_ONLY_SEARCH = '?onboardingId=018f1e2a-eeee-7000-8000-00000000000e';
const NO_MATCH_SEARCH = '?workflowId=does-not-match';
const RELOAD_QUERY_SEARCH = '?workflowId=kyc-reloaded';

type AdminOnboardingStatus = 'awaiting_user' | 'approved';

type Filters = {
  status: '' | AdminOnboardingStatus;
  workflowId: string;
  workflowVersion: string;
  currentStep: string;
  onboardingId: string;
};

type AdminOnboardingFixtureRecord = AdminOnboardingSummary & {
  context: { hidden: string };
};

type EngineRequestRecord = {
  method: string;
  url: string;
  pathname: string;
  search: string;
  origin: string | null;
  headers: Record<string, string>;
};

type EngineResponseRecord = {
  url: string;
  pathname: string;
  search: string;
  status: number;
};

const RELOAD_FIXTURE: AdminOnboardingFixtureRecord[] = [
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
    context: { hidden: 'fixture-context-row-four' },
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

  get applyButton() {
    return this.page.getByRole('button', { name: 'Apply filters' });
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

  async applyFilters() {
    await this.applyButton.click();
  }

  async resetFilters() {
    await this.resetButton.click();
  }

  async reload() {
    await this.reloadButton.click();
  }
}

function createTrafficLog(page: Page) {
  const requests: EngineRequestRecord[] = [];
  const responses: EngineResponseRecord[] = [];
  const unexpectedRequests: string[] = [];

  page.on('request', (request) => {
    const url = new URL(request.url());

    if (url.origin !== ENGINE_ORIGIN) {
      return;
    }

    const headers = request.headers();
    const record = {
      method: request.method(),
      url: request.url(),
      pathname: url.pathname,
      search: url.search,
      origin: headers.origin ?? null,
      headers,
    };

    requests.push(record);

    if (
      record.pathname !== ENGINE_ONBOARDINGS_PATH ||
      !['GET', 'OPTIONS'].includes(record.method)
    ) {
      unexpectedRequests.push(record.url);
    }
  });

  page.on('response', (response) => {
    const url = new URL(response.url());

    if (url.origin !== ENGINE_ORIGIN || url.pathname !== ENGINE_ONBOARDINGS_PATH) {
      return;
    }

    responses.push({
      url: response.url(),
      pathname: url.pathname,
      search: url.search,
      status: response.status(),
    });
  });

  return {
    requests,
    responses,
    unexpectedRequests,
  };
}

async function waitForTraffic(
  traffic: { requests: EngineRequestRecord[]; responses: EngineResponseRecord[] },
  count: number,
) {
  await expect.poll(() => traffic.requests.length).toBe(count);
  await expect.poll(() => traffic.responses.length).toBe(count);
}

function expectDirectRequest(record: EngineRequestRecord, search = '') {
  expect(record.method).toBe('GET');
  expect(record.pathname).toBe(ENGINE_ONBOARDINGS_PATH);
  expect(record.search).toBe(search);
  expect(record.url).toBe(`${ENGINE_ONBOARDINGS_URL}${search}`);
  expect(record.url).not.toContain('/api');
  expect(record.url).not.toContain('proxy');
  expect(record.url).not.toContain('bff');
}

function expectNoCredentialsOrCustomHeaders(record: EngineRequestRecord) {
  expect(record.headers.cookie).toBeUndefined();
  expect(record.headers.authorization).toBeUndefined();
  expect(record.headers['proxy-authorization']).toBeUndefined();
  expect(record.headers['x-requested-with']).toBeUndefined();
  expect(Object.keys(record.headers).some((key) => key.startsWith('x-'))).toBe(false);
}

async function stubRecoveryResponses(page: Page) {
  let queryRequestCount = 0;
  let releaseInitial: (() => void) | null = null;
  let releaseReload: (() => void) | null = null;
  const initialReady = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  const reloadReady = new Promise<void>((resolve) => {
    releaseReload = resolve;
  });

  await page.route(ENGINE_ONBOARDINGS_ROUTE, async (route) => {
    const url = new URL(route.request().url());

    if (url.search === '') {
      await route.continue();
      return;
    }

    queryRequestCount += 1;

    if (queryRequestCount === 1) {
      await initialReady;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'upstream unavailable' }),
      });
      return;
    }

    await reloadReady;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(RELOAD_FIXTURE),
    });
  });

  return {
    releaseInitial: () => {
      releaseInitial?.();
    },
    releaseReload: () => {
      releaseReload?.();
    },
  };
}

test.describe.serial('admin onboardings', () => {
  test('should request the configured direct engine origin and support endpoint-backed filters', async ({
    page,
  }) => {
    const app = new AdminOnboardingsPage(page);
    const traffic = createTrafficLog(page);

    await app.goto();
    await expect(app.statusRegion).toHaveText('Loading onboardings…');
    await waitForTraffic(traffic, 1);

    await expect(app.heading).toBeVisible();
    await expect(app.statusRegion).toHaveText('Showing 40 onboardings.');
    await expect(app.table).toBeVisible();
    await expect(app.table).toContainText(
      'kyc-enhanced-with-an-excessively-long-workflow-identifier-for-scroll-testing',
    );
    await expect(app.table).toContainText(
      'collect-documents-with-a-long-step-name-to-force-table-overflow',
    );
    await expect(app.table).toContainText('kyc basic / encoding?');
    await expect(app.table).not.toContainText('fixture-context-row-1');
    await expect(app.table).not.toContainText('fixture-context-special');

    expectDirectRequest(traffic.requests[0], '');
    expectNoCredentialsOrCustomHeaders(traffic.requests[0]);
    expect(traffic.responses[0]).toEqual(
      expect.objectContaining({
        url: ENGINE_ONBOARDINGS_URL,
        pathname: ENGINE_ONBOARDINGS_PATH,
        search: '',
        status: 200,
      }),
    );

    await app.fillFilters({ workflowId: '  kyc basic / encoding?  ' });
    await expect(app.statusRegion).toHaveText('Showing 40 onboardings.');
    expect(traffic.requests).toHaveLength(1);

    await app.applyFilters();
    await waitForTraffic(traffic, 2);
    await expect(app.statusRegion).toHaveText('Showing 1 onboardings.');
    await expect(app.table).toContainText('018f1e2a-eeee-7000-8000-00000000000e');
    await expect(app.table).toContainText('final review / qa?');
    await expect(page.getByText('fixture-context-special')).toHaveCount(0);
    expectDirectRequest(traffic.requests[1], WORKFLOW_ID_ONLY_SEARCH);
    expectNoCredentialsOrCustomHeaders(traffic.requests[1]);
    expect(traffic.responses[1]).toEqual(
      expect.objectContaining({
        url: `${ENGINE_ONBOARDINGS_URL}${WORKFLOW_ID_ONLY_SEARCH}`,
        pathname: ENGINE_ONBOARDINGS_PATH,
        search: WORKFLOW_ID_ONLY_SEARCH,
        status: 200,
      }),
    );

    await app.resetFilters();
    await waitForTraffic(traffic, 3);
    await expect(app.statusRegion).toHaveText('Showing 40 onboardings.');
    expectDirectRequest(traffic.requests[2], '');
    expectNoCredentialsOrCustomHeaders(traffic.requests[2]);

    await app.fillFilters({ status: 'approved' });
    await app.applyFilters();
    await waitForTraffic(traffic, 4);
    await expect(app.statusRegion).toHaveText('Showing 20 onboardings.');
    expectDirectRequest(traffic.requests[3], STATUS_ONLY_SEARCH);
    await expect(app.table).toContainText('approved');

    await app.resetFilters();
    await waitForTraffic(traffic, 5);
    expectDirectRequest(traffic.requests[4], '');

    await app.fillFilters({ workflowVersion: '7' });
    await app.applyFilters();
    await waitForTraffic(traffic, 6);
    await expect(app.statusRegion).toHaveText('Showing 1 onboardings.');
    expectDirectRequest(traffic.requests[5], WORKFLOW_VERSION_ONLY_SEARCH);
    await expect(app.table).toContainText('kyc basic / encoding?');

    await app.resetFilters();
    await waitForTraffic(traffic, 7);
    expectDirectRequest(traffic.requests[6], '');

    await app.fillFilters({ currentStep: 'final review / qa?' });
    await app.applyFilters();
    await waitForTraffic(traffic, 8);
    await expect(app.statusRegion).toHaveText('Showing 1 onboardings.');
    expectDirectRequest(traffic.requests[7], CURRENT_STEP_ONLY_SEARCH);

    await app.resetFilters();
    await waitForTraffic(traffic, 9);
    expectDirectRequest(traffic.requests[8], '');

    await app.fillFilters({ onboardingId: SPECIAL_ONBOARDING_ID });
    await app.applyFilters();
    await waitForTraffic(traffic, 10);
    await expect(app.statusRegion).toHaveText('Showing 1 onboardings.');
    expectDirectRequest(traffic.requests[9], ONBOARDING_ID_ONLY_SEARCH);

    await app.resetFilters();
    await waitForTraffic(traffic, 11);
    expectDirectRequest(traffic.requests[10], '');

    await app.fillFilters({
      status: 'approved',
      workflowId: SPECIAL_WORKFLOW_ID,
      workflowVersion: '7',
      currentStep: SPECIAL_CURRENT_STEP,
      onboardingId: SPECIAL_ONBOARDING_ID,
    });
    await app.applyFilters();
    await waitForTraffic(traffic, 12);
    await expect(app.statusRegion).toHaveText('Showing 1 onboardings.');
    expectDirectRequest(traffic.requests[11], SPECIAL_REQUEST_SEARCH);
    await expect(app.table).not.toContainText('fixture-context-special');
    await expect(page.getByText('fixture-context-special')).toHaveCount(0);

    await app.resetFilters();
    await waitForTraffic(traffic, 13);
    await expect(app.statusRegion).toHaveText('Showing 40 onboardings.');
    expectDirectRequest(traffic.requests[12], '');

    await app.fillFilters({ workflowId: 'does-not-match' });
    await app.applyFilters();
    await waitForTraffic(traffic, 14);
    await expect(app.statusRegion).toHaveText('No onboardings match the current filters.');
    await expect(app.table).toContainText('No onboardings match the current filters.');
    expectDirectRequest(traffic.requests[13], NO_MATCH_SEARCH);

    await app.resetFilters();
    await waitForTraffic(traffic, 15);
    await expect(app.statusRegion).toHaveText('Showing 40 onboardings.');
    expectDirectRequest(traffic.requests[14], '');

    expect(traffic.unexpectedRequests).toEqual([]);
  });

  test('should show loading, error, recovery, and invalid-input states while repeating the applied query', async ({
    page,
  }) => {
    const app = new AdminOnboardingsPage(page);
    const traffic = createTrafficLog(page);
    const recovery = await stubRecoveryResponses(page);

    await app.goto();
    await expect(app.statusRegion).toHaveText('Loading onboardings…');
    await waitForTraffic(traffic, 1);

    await expect(app.statusRegion).toHaveText('Showing 40 onboardings.');
    await app.fillFilters({ workflowId: 'kyc-reloaded' });
    await app.applyFilters();
    await expect.poll(() => traffic.requests.length).toBe(2);
    recovery.releaseInitial();
    await waitForTraffic(traffic, 2);

    await expect(app.statusRegion).toHaveText(
      'Unable to load onboardings: Request failed with status 500.',
    );
    expectDirectRequest(traffic.requests[1], RELOAD_QUERY_SEARCH);
    expect(traffic.responses[1]).toEqual(
      expect.objectContaining({
        url: `${ENGINE_ONBOARDINGS_URL}${RELOAD_QUERY_SEARCH}`,
        pathname: ENGINE_ONBOARDINGS_PATH,
        search: RELOAD_QUERY_SEARCH,
        status: 500,
      }),
    );

    await app.reload();
    await expect.poll(() => traffic.requests.length).toBe(3);
    recovery.releaseReload();
    await waitForTraffic(traffic, 3);

    await expect(app.statusRegion).toHaveText('Showing 1 onboardings.');
    await expect(app.table).toContainText('kyc-reloaded');
    await expect(app.table).toContainText('final-review');
    expectDirectRequest(traffic.requests[2], RELOAD_QUERY_SEARCH);
    expect(traffic.responses[2]).toEqual(
      expect.objectContaining({
        url: `${ENGINE_ONBOARDINGS_URL}${RELOAD_QUERY_SEARCH}`,
        pathname: ENGINE_ONBOARDINGS_PATH,
        search: RELOAD_QUERY_SEARCH,
        status: 200,
      }),
    );

    const requestsBeforeInvalidVersion = traffic.requests.length;
    await app.fillFilters({ workflowVersion: 'abc' });
    await app.applyFilters();
    await expect(app.statusRegion).toHaveText('Enter a whole number greater than zero.');
    expect(traffic.requests).toHaveLength(requestsBeforeInvalidVersion);
    await expect(app.table).toContainText('kyc-reloaded');

    expect(traffic.unexpectedRequests).toEqual([]);
  });

  test('should keep the table wrapper contained and preserve keyboard activation for Reload and Reset', async ({
    page,
  }) => {
    const app = new AdminOnboardingsPage(page);
    const traffic = createTrafficLog(page);

    await app.goto();
    await expect(app.statusRegion).toHaveText('Loading onboardings…');
    await waitForTraffic(traffic, 1);

    await expect(app.statusRegion).toHaveText('Showing 40 onboardings.');
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
    expect(wrapperMetrics.scrollHeight).toBeGreaterThanOrEqual(wrapperMetrics.clientHeight);
    expect(wrapperMetrics.bottom).toBeLessThanOrEqual(720);

    const pageMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(pageMetrics.scrollWidth).toBeLessThanOrEqual(pageMetrics.clientWidth);

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

      if (active.tagName === 'BUTTON' && active.text === 'Reload') {
        break;
      }
    }

    const focusedReload = await page.evaluate(() => {
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

    expect(focusedReload).not.toBeNull();
    expect(focusedReload?.tagName).toBe('BUTTON');
    expect(focusedReload?.text).toBe('Reload');
    expect(focusedReload?.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(focusedReload?.outlineWidth ?? '0')).toBeGreaterThan(0);

    await page.keyboard.press('Space');
    await waitForTraffic(traffic, 2);
    expectDirectRequest(traffic.requests[1], '');

    await page.keyboard.press('Tab');
    const focusedReset = await page.evaluate(() => {
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

    expect(focusedReset).not.toBeNull();
    expect(focusedReset?.tagName).toBe('BUTTON');
    expect(focusedReset?.text).toBe('Reset filters');
    expect(focusedReset?.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(focusedReset?.outlineWidth ?? '0')).toBeGreaterThan(0);

    await page.keyboard.press('Space');
    await waitForTraffic(traffic, 3);
    expectDirectRequest(traffic.requests[2], '');
    expect(traffic.unexpectedRequests).toEqual([]);
  });
});
