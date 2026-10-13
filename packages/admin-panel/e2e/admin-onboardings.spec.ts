import { expect, test, type Page } from '@playwright/test';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';

const APP_URL = process.env.BASE_URL || 'http://localhost:5174';
const ENGINE_BASE_URL = process.env.VITE_ENGINE_API_BASE_URL;
const ENGINE_ONBOARDINGS_PATH = '/v1/onboardings';
const ENGINE_ONBOARDINGS_ROUTE = '**/v1/onboardings**';

if (!ENGINE_BASE_URL) {
  throw new Error('VITE_ENGINE_API_BASE_URL must be provided to the admin-panel Playwright suite.');
}

const ENGINE_ORIGIN = new URL(ENGINE_BASE_URL).origin;
const ENGINE_ONBOARDINGS_URL = `${ENGINE_ORIGIN}${ENGINE_ONBOARDINGS_PATH}`;
const SPECIAL_WORKFLOW_ID = 'kyc basic / encoding?';
const SPECIAL_CURRENT_STEP = 'final review / qa?';
const SPECIAL_ONBOARDING_ID = '018f1e2a-eeee-7000-8000-00000000000e';
/**
 * The page window the panel states on every request, ahead of any filter criteria. The endpoint
 * paginates whether or not it is asked to, so there is no longer an empty query string.
 */
const PAGE_WINDOW_SEARCH = '?page=1&limit=100';
/** The window a paging run works in, once it has narrowed the page size enough to have pages. */
const SMALL_PAGE_SEARCH = '?page=1&limit=20';
const SECOND_PAGE_SEARCH = '?page=2&limit=20';
const SPECIAL_REQUEST_SEARCH = `${PAGE_WINDOW_SEARCH}&status=approved&workflowId=kyc+basic+%2F+encoding%3F&workflowVersion=7&currentStep=final+review+%2F+qa%3F&onboardingId=018f1e2a-eeee-7000-8000-00000000000e`;
/** The same combined request, before the status tab click adds `status` on top of it. */
const SPECIAL_REQUEST_WITHOUT_STATUS_SEARCH = `${PAGE_WINDOW_SEARCH}&workflowId=kyc+basic+%2F+encoding%3F&workflowVersion=7&currentStep=final+review+%2F+qa%3F&onboardingId=018f1e2a-eeee-7000-8000-00000000000e`;
/** The same combined request, before Apply commits the onboarding ID field on top of it. */
const SPECIAL_REQUEST_WITHOUT_ONBOARDING_ID_SEARCH = `${PAGE_WINDOW_SEARCH}&status=approved&workflowId=kyc+basic+%2F+encoding%3F&workflowVersion=7&currentStep=final+review+%2F+qa%3F`;
const WORKFLOW_ID_ONLY_SEARCH = `${PAGE_WINDOW_SEARCH}&workflowId=kyc+basic+%2F+encoding%3F`;
const STATUS_ONLY_SEARCH = `${PAGE_WINDOW_SEARCH}&status=approved`;
const WORKFLOW_VERSION_ONLY_SEARCH = `${PAGE_WINDOW_SEARCH}&workflowVersion=7`;
const CURRENT_STEP_ONLY_SEARCH = `${PAGE_WINDOW_SEARCH}&currentStep=final+review+%2F+qa%3F`;
const ONBOARDING_ID_ONLY_SEARCH = `${PAGE_WINDOW_SEARCH}&onboardingId=018f1e2a-eeee-7000-8000-00000000000e`;
const NO_MATCH_SEARCH = `${PAGE_WINDOW_SEARCH}&workflowId=does-not-match`;
const RELOAD_QUERY_SEARCH = `${PAGE_WINDOW_SEARCH}&workflowId=kyc-reloaded`;
/** What the unfiltered list reports: all 40 fixture rows fit inside the default 100-row window. */
const UNFILTERED_STATUS = 'Showing 40 of 40 onboardings (page 1 of 1).';
/** The same 40 rows once the operator has narrowed the page size to 20, which is two pages. */
const SMALL_PAGE_STATUS = 'Showing 20 of 40 onboardings (page 1 of 2).';
const SMALL_PAGE_SECOND_PAGE_STATUS = 'Showing 20 of 40 onboardings (page 2 of 2).';

type AdminOnboardingStatus =
  'awaiting_user' | 'awaiting_manual_review' | 'approved' | 'rejected' | 'invalid';

/** The status tab strip's accessible label for each committed status; '' means the All tab. */
const STATUS_TAB_LABELS: Record<'' | AdminOnboardingStatus, string> = {
  '': 'All',
  awaiting_user: 'Awaiting user',
  awaiting_manual_review: 'Awaiting manual review',
  approved: 'Approved',
  rejected: 'Rejected',
  invalid: 'Invalid',
};

type Filters = {
  workflowId: string;
  workflowVersion: string;
  currentStep: string;
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
    scores: {},
    pendingConnector: null,
    context: { hidden: 'fixture-context-row-four' },
  },
];

class AdminOnboardingsPage {
  constructor(readonly page: Page) {}

  get heading() {
    return this.page.getByRole('heading', { level: 1, name: 'Onboardings' });
  }

  get onboardingsTab() {
    return this.page.getByRole('link', { name: 'Onboardings' });
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

  get statusNav() {
    return this.page.getByRole('navigation', { name: 'Status' });
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

  get pager() {
    return this.page.getByRole('navigation', { name: 'Onboarding pages' });
  }

  get nextPageButton() {
    return this.page.getByRole('button', { name: 'Next' });
  }

  // Exact, so it does not also match the 'Per page' filter.
  get pageInput() {
    return this.page.getByLabel('Page', { exact: true });
  }

  get previousPageButton() {
    return this.page.getByRole('button', { name: 'Previous' });
  }

  get pageSizeFilter() {
    return this.page.getByLabel('Per page');
  }

  columnHeader(name: string) {
    return this.page.getByRole('columnheader', { name });
  }

  async goToNextPage() {
    await this.nextPageButton.click();
  }

  async goToPreviousPage() {
    await this.previousPageButton.click();
  }

  async jumpToPage(page: number) {
    await this.pageInput.fill(String(page));
    await this.pageInput.press('Enter');
  }

  async goto() {
    await this.page.goto(APP_URL);
  }

  async fillFilters(filters: Partial<Filters>) {
    if (filters.workflowId !== undefined) {
      await this.workflowIdFilter.fill(filters.workflowId);
    }

    if (filters.workflowVersion !== undefined) {
      await this.workflowVersionFilter.fill(filters.workflowVersion);
    }

    if (filters.currentStep !== undefined) {
      await this.currentStepFilter.fill(filters.currentStep);
    }
  }

  async applyFilters() {
    await this.applyButton.click();
  }

  statusTab(status: '' | AdminOnboardingStatus) {
    return this.statusNav.getByRole('link', { name: STATUS_TAB_LABELS[status] });
  }

  async selectStatus(status: '' | AdminOnboardingStatus) {
    await this.statusTab(status).click();
  }

  async searchOnboardingId(onboardingId: string) {
    await this.onboardingIdFilter.fill(onboardingId);
    await this.applyFilters();
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

function expectDirectRequest(record: EngineRequestRecord, search = PAGE_WINDOW_SEARCH) {
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

    // Every request now carries the page window, so the unfiltered load is the one with no
    // filter criteria beyond it rather than the one with no query string at all.
    if (!url.searchParams.has('workflowId')) {
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
      body: JSON.stringify({
        items: RELOAD_FIXTURE,
        meta: {
          pagination: { page: 1, limit: 100, total: RELOAD_FIXTURE.length, totalPages: 1 },
        },
      }),
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
    // The root path forwards to the onboardings section, which owns its own URL.
    await expect(page).toHaveURL(/\/onboardings$/);
    await expect(app.onboardingsTab).toHaveAttribute('aria-current', 'page');
    await expect(app.statusRegion).toHaveText(UNFILTERED_STATUS);
    await expect(app.table).toBeVisible();
    await expect(app.table).toContainText(
      'kyc-enhanced-with-an-excessively-long-workflow-identifier-for-scroll-testing',
    );
    await expect(app.table).toContainText(
      'collect-documents-with-a-long-step-name-to-force-table-overflow',
    );
    await expect(app.table).not.toContainText('fixture-context-row-1');
    await expect(app.pager).toContainText('of 1');
    await expect(app.pageInput).toHaveValue('1');
    await expect(app.previousPageButton).toBeDisabled();

    expectDirectRequest(traffic.requests[0]);
    expectNoCredentialsOrCustomHeaders(traffic.requests[0]);
    expect(traffic.responses[0]).toEqual(
      expect.objectContaining({
        url: `${ENGINE_ONBOARDINGS_URL}${PAGE_WINDOW_SEARCH}`,
        pathname: ENGINE_ONBOARDINGS_PATH,
        search: PAGE_WINDOW_SEARCH,
        status: 200,
      }),
    );

    await app.fillFilters({ workflowId: '  kyc basic / encoding?  ' });
    await expect(app.statusRegion).toHaveText(UNFILTERED_STATUS);
    expect(traffic.requests).toHaveLength(1);

    await app.applyFilters();
    await waitForTraffic(traffic, 2);
    await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings (page 1 of 1).');
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
    await expect(app.statusRegion).toHaveText(UNFILTERED_STATUS);
    expectDirectRequest(traffic.requests[2]);
    expectNoCredentialsOrCustomHeaders(traffic.requests[2]);

    await app.selectStatus('approved');
    await waitForTraffic(traffic, 4);
    await expect(app.statusRegion).toHaveText('Showing 20 of 20 onboardings (page 1 of 1).');
    expectDirectRequest(traffic.requests[3], STATUS_ONLY_SEARCH);
    // The status cell renders the human label through the chip, not the raw engine value.
    await expect(app.table).toContainText('Approved');

    await app.resetFilters();
    await waitForTraffic(traffic, 5);
    expectDirectRequest(traffic.requests[4]);

    await app.fillFilters({ workflowVersion: '7' });
    await app.applyFilters();
    await waitForTraffic(traffic, 6);
    await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings (page 1 of 1).');
    expectDirectRequest(traffic.requests[5], WORKFLOW_VERSION_ONLY_SEARCH);
    await expect(app.table).toContainText('kyc basic / encoding?');

    await app.resetFilters();
    await waitForTraffic(traffic, 7);
    expectDirectRequest(traffic.requests[6]);

    await app.fillFilters({ currentStep: 'final review / qa?' });
    await app.applyFilters();
    await waitForTraffic(traffic, 8);
    await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings (page 1 of 1).');
    expectDirectRequest(traffic.requests[7], CURRENT_STEP_ONLY_SEARCH);

    await app.resetFilters();
    await waitForTraffic(traffic, 9);
    expectDirectRequest(traffic.requests[8]);

    await app.searchOnboardingId(SPECIAL_ONBOARDING_ID);
    await waitForTraffic(traffic, 10);
    await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings (page 1 of 1).');
    expectDirectRequest(traffic.requests[9], ONBOARDING_ID_ONLY_SEARCH);

    await app.resetFilters();
    await waitForTraffic(traffic, 11);
    expectDirectRequest(traffic.requests[10]);

    // Status now commits by its own tab click, which merges onto whatever is already applied
    // rather than a shared draft, so the combined criteria commit in two steps: the other four
    // first (workflow fields and onboarding ID all drafted, then committed together by Apply),
    // then status last.
    await app.fillFilters({
      workflowId: SPECIAL_WORKFLOW_ID,
      workflowVersion: '7',
      currentStep: SPECIAL_CURRENT_STEP,
    });
    await app.searchOnboardingId(SPECIAL_ONBOARDING_ID);
    await waitForTraffic(traffic, 12);
    await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings (page 1 of 1).');
    expectDirectRequest(traffic.requests[11], SPECIAL_REQUEST_WITHOUT_STATUS_SEARCH);

    await app.selectStatus('approved');
    await waitForTraffic(traffic, 13);
    await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings (page 1 of 1).');
    expectDirectRequest(traffic.requests[12], SPECIAL_REQUEST_SEARCH);
    await expect(app.table).not.toContainText('fixture-context-special');
    await expect(page.getByText('fixture-context-special')).toHaveCount(0);

    await app.resetFilters();
    await waitForTraffic(traffic, 14);
    await expect(app.statusRegion).toHaveText(UNFILTERED_STATUS);
    expectDirectRequest(traffic.requests[13]);

    // The same five criteria in the operator's natural order - the status tab first, then the
    // panel fields narrowed inside it. The tab click navigates without remounting the page, so
    // this is the ordering that regresses if the filter draft ever carries its own `status`:
    // the Apply below would commit the stale copy and silently drop the tab.
    await app.selectStatus('approved');
    await waitForTraffic(traffic, 15);
    expectDirectRequest(traffic.requests[14], STATUS_ONLY_SEARCH);

    await app.fillFilters({
      workflowId: SPECIAL_WORKFLOW_ID,
      workflowVersion: '7',
      currentStep: SPECIAL_CURRENT_STEP,
    });
    await app.applyFilters();
    await waitForTraffic(traffic, 16);
    expectDirectRequest(traffic.requests[15], SPECIAL_REQUEST_WITHOUT_ONBOARDING_ID_SEARCH);
    await expect(app.statusTab('approved')).toHaveAttribute('aria-current', 'page');

    await app.searchOnboardingId(SPECIAL_ONBOARDING_ID);
    await waitForTraffic(traffic, 17);
    await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings (page 1 of 1).');
    expectDirectRequest(traffic.requests[16], SPECIAL_REQUEST_SEARCH);
    await expect(app.statusTab('approved')).toHaveAttribute('aria-current', 'page');

    await app.resetFilters();
    await waitForTraffic(traffic, 18);
    await expect(app.statusRegion).toHaveText(UNFILTERED_STATUS);
    expectDirectRequest(traffic.requests[17]);

    await app.fillFilters({ workflowId: 'does-not-match' });
    await app.applyFilters();
    await waitForTraffic(traffic, 19);
    await expect(app.statusRegion).toHaveText('No onboardings match the current filters.');
    await expect(app.table).toContainText('No onboardings match the current filters.');
    expectDirectRequest(traffic.requests[18], NO_MATCH_SEARCH);

    await app.resetFilters();
    await waitForTraffic(traffic, 20);
    await expect(app.statusRegion).toHaveText(UNFILTERED_STATUS);
    expectDirectRequest(traffic.requests[19]);

    expect(traffic.unexpectedRequests).toEqual([]);
  });

  test('should step through the paginated list and honour the selected page size', async ({
    page,
  }) => {
    const app = new AdminOnboardingsPage(page);
    const traffic = createTrafficLog(page);

    await app.goto();
    await waitForTraffic(traffic, 1);

    // The default window holds the whole fixture, so paging is exercised from a narrower one.
    await expect(app.statusRegion).toHaveText(UNFILTERED_STATUS);
    expectDirectRequest(traffic.requests[0]);

    await app.pageSizeFilter.selectOption('20');
    await app.applyFilters();
    await waitForTraffic(traffic, 2);

    await expect(app.statusRegion).toHaveText(SMALL_PAGE_STATUS);
    await expect(app.pager).toContainText('of 2');
    await expect(app.pageInput).toHaveValue('1');
    expectDirectRequest(traffic.requests[1], SMALL_PAGE_SEARCH);

    await app.goToNextPage();
    await waitForTraffic(traffic, 3);

    await expect(app.statusRegion).toHaveText(SMALL_PAGE_SECOND_PAGE_STATUS);
    await expect(app.pageInput).toHaveValue('2');
    await expect(app.nextPageButton).toBeDisabled();
    // The fixture's special-character row is the last of the 40, so it is only ever on page 2.
    await expect(app.table).toContainText('kyc basic / encoding?');
    await expect(app.table).toContainText('final review / qa?');
    await expect(app.table).not.toContainText('fixture-context-special');
    expectDirectRequest(traffic.requests[2], SECOND_PAGE_SEARCH);
    expectNoCredentialsOrCustomHeaders(traffic.requests[2]);

    await app.goToPreviousPage();
    await waitForTraffic(traffic, 4);

    await expect(app.statusRegion).toHaveText(SMALL_PAGE_STATUS);
    expectDirectRequest(traffic.requests[3], SMALL_PAGE_SEARCH);

    // Naming a page requests it directly, rather than stepping through the ones before it.
    await app.jumpToPage(2);
    await waitForTraffic(traffic, 5);

    await expect(app.statusRegion).toHaveText(SMALL_PAGE_SECOND_PAGE_STATUS);
    await expect(app.pageInput).toHaveValue('2');
    expectDirectRequest(traffic.requests[4], SECOND_PAGE_SEARCH);

    await app.pageSizeFilter.selectOption('50');
    await app.applyFilters();
    await waitForTraffic(traffic, 6);

    await expect(app.statusRegion).toHaveText('Showing 40 of 40 onboardings (page 1 of 1).');
    await expect(app.table).toContainText('kyc basic / encoding?');
    expectDirectRequest(traffic.requests[5], '?page=1&limit=50');

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

    await expect(app.statusRegion).toHaveText(UNFILTERED_STATUS);
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

    await expect(app.statusRegion).toHaveText('Showing 1 of 1 onboardings (page 1 of 1).');
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

    await expect(app.statusRegion).toHaveText(UNFILTERED_STATUS);
    await expect(app.table).toBeVisible();
    await expect(app.tableCaption).toHaveText('Onboardings matching the current filters');
    const captionBox = await app.tableCaption.evaluate((caption) => {
      const rect = caption.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(captionBox.width).toBeLessThanOrEqual(1);
    expect(captionBox.height).toBeLessThanOrEqual(1);
    await expect(app.columnHeader('Onboarding')).toBeVisible();
    await expect(app.columnHeader('Workflow')).toBeVisible();
    await expect(app.columnHeader('Status')).toBeVisible();
    await expect(app.columnHeader('Current step')).toBeVisible();
    await expect(app.columnHeader('Started')).toBeVisible();
    await expect(app.columnHeader('Last activity')).toBeVisible();
    await expect(app.columnHeader('Expires')).toBeVisible();
    await expect(app.columnHeader('Completed')).toBeVisible();
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

    // The six status tabs sit ahead of the filter panel in tab order; the onboarding ID field is
    // the panel's first control.
    for (let index = 0; index < 30; index += 1) {
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
    expectDirectRequest(traffic.requests[1]);

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
    expectDirectRequest(traffic.requests[2]);
    expect(traffic.unexpectedRequests).toEqual([]);
  });
});
