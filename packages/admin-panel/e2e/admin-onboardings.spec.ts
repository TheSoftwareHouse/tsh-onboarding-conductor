import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const adminOnboardingsUrl = 'http://localhost:3000/v1/admin/onboardings';
const demoStartOnboardingUrl = 'http://localhost:3001/v1/onboardings';

type FilterName = 'status' | 'workflowId' | 'workflowVersion' | 'currentStep' | 'onboardingId';

type FilterCase = {
  label: string;
  fieldLabel: string;
  queryKey: FilterName;
  value: string;
  inputType: 'select' | 'text';
};

const filterCases: FilterCase[] = [
  {
    label: 'should send only status when status filter is applied',
    fieldLabel: 'Status',
    queryKey: 'status',
    value: 'approved',
    inputType: 'select',
  },
  {
    label: 'should send only workflowId when workflowId filter is applied',
    fieldLabel: 'Workflow ID',
    queryKey: 'workflowId',
    value: 'workflow-123',
    inputType: 'text',
  },
  {
    label: 'should send only workflowVersion when workflowVersion filter is applied',
    fieldLabel: 'Workflow version',
    queryKey: 'workflowVersion',
    value: '7',
    inputType: 'text',
  },
  {
    label: 'should send only currentStep when currentStep filter is applied',
    fieldLabel: 'Current step',
    queryKey: 'currentStep',
    value: 'collect_contact',
    inputType: 'text',
  },
  {
    label: 'should send only onboardingId when onboardingId filter is applied',
    fieldLabel: 'Onboarding ID',
    queryKey: 'onboardingId',
    value: '00000000-0000-4000-8000-000000000001',
    inputType: 'text',
  },
];

async function openPanel(page: Page) {
  const listResponsePromise = page.waitForResponse(
    (response) => response.url() === adminOnboardingsUrl && response.request().method() === 'GET',
  );

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Admin onboarding list' })).toBeVisible();

  const listResponse = await listResponsePromise;
  expect(listResponse.ok()).toBeTruthy();
}

async function startDemoOnboarding(request: APIRequestContext): Promise<string> {
  const response = await request.post(demoStartOnboardingUrl, {
    data: { workflowKey: 'base' },
  });

  expect(response.ok()).toBeTruthy();

  const body = (await response.json()) as { onboardingId?: string };
  expect(body.onboardingId).toBeTruthy();

  return body.onboardingId as string;
}

async function captureListRequest(
  page: Page,
  trigger: () => Promise<void> | void,
): Promise<{ url: URL; responseStatus: number }> {
  const requestPromise = page.waitForRequest(
    (request) => request.url().startsWith(adminOnboardingsUrl) && request.method() === 'GET',
  );
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().startsWith(adminOnboardingsUrl) && response.request().method() === 'GET',
  );

  await trigger();

  const [request, response] = await Promise.all([requestPromise, responsePromise]);

  return {
    url: new URL(request.url()),
    responseStatus: response.status(),
  };
}

function expectOnlyQueryNames(url: URL, expectedNames: FilterName[]) {
  expect([...url.searchParams.keys()].sort()).toEqual([...expectedNames].sort());
}

test('should load a seeded onboarding row when the onboardingId filter matches', async ({
  page,
  request,
}) => {
  const onboardingId = await startDemoOnboarding(request);

  await openPanel(page);

  const requestDetails = await captureListRequest(page, async () => {
    await page.getByLabel('Onboarding ID').fill(onboardingId);
    await page.getByRole('button', { name: 'Apply' }).click();
  });

  expect(requestDetails.responseStatus).toBe(200);
  expectOnlyQueryNames(requestDetails.url, ['onboardingId']);
  expect(requestDetails.url.searchParams.get('onboardingId')).toBe(onboardingId);

  await expect(page.getByRole('table', { name: 'Admin onboardings' })).toBeVisible();
  await expect(page.getByRole('cell', { name: onboardingId })).toBeVisible();
});

for (const filterCase of filterCases) {
  test(filterCase.label, async ({ page }) => {
    await openPanel(page);

    const requestDetails = await captureListRequest(page, async () => {
      if (filterCase.inputType === 'select') {
        await page.getByLabel(filterCase.fieldLabel).selectOption(filterCase.value);
      } else {
        await page.getByLabel(filterCase.fieldLabel).fill(filterCase.value);
      }

      await page.getByRole('button', { name: 'Apply' }).click();
    });

    expect(requestDetails.responseStatus).toBe(200);
    expectOnlyQueryNames(requestDetails.url, [filterCase.queryKey]);
    expect(requestDetails.url.searchParams.get(filterCase.queryKey)).toBe(filterCase.value);
  });
}

test('should clear filters and request unfiltered data when Clear is used', async ({ page }) => {
  await openPanel(page);

  await captureListRequest(page, async () => {
    await page.getByLabel('Status').selectOption('approved');
    await page.getByRole('button', { name: 'Apply' }).click();
  });

  const requestDetails = await captureListRequest(page, async () => {
    await page.getByRole('button', { name: 'Clear' }).click();
  });

  expect(requestDetails.responseStatus).toBe(200);
  expect(requestDetails.url.search).toBe('');
  expectOnlyQueryNames(requestDetails.url, []);
});

test('should show an empty state when the filter set matches no onboardings', async ({ page }) => {
  await openPanel(page);

  const requestDetails = await captureListRequest(page, async () => {
    await page.getByLabel('Onboarding ID').fill('00000000-0000-0000-0000-000000000000');
    await page.getByRole('button', { name: 'Apply' }).click();
  });

  expect(requestDetails.responseStatus).toBe(200);
  expectOnlyQueryNames(requestDetails.url, ['onboardingId']);

  await expect(page.getByText('No admin onboardings match the current filters.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Admin onboardings' })).toHaveCount(0);
});

test('should show a generic error and recover on retry when the list request fails', async ({
  page,
}) => {
  await openPanel(page);

  let failNextListRequest = true;

  await page.route('**/v1/admin/onboardings*', async (route) => {
    if (failNextListRequest) {
      failNextListRequest = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'simulated failure' }),
      });
      return;
    }

    await route.continue();
  });

  const failedRequest = await captureListRequest(page, async () => {
    await page.getByLabel('Status').selectOption('approved');
    await page.getByRole('button', { name: 'Apply' }).click();
  });

  expect(failedRequest.url.searchParams.get('status')).toBe('approved');
  expect(failedRequest.responseStatus).toBe(500);

  await expect(page.getByRole('alert')).toContainText('Unable to load admin onboardings.');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

  const retryRequest = await captureListRequest(page, async () => {
    await page.getByRole('button', { name: 'Retry' }).click();
  });

  expect(retryRequest.responseStatus).toBe(200);
  await expect(page.getByRole('table', { name: 'Admin onboardings' })).toBeVisible();
});

async function measureHorizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test('should keep the onboardings table within the page at desktop and narrow widths', async ({
  page,
  request,
}) => {
  const onboardingId = await startDemoOnboarding(request);

  await openPanel(page);

  await captureListRequest(page, async () => {
    await page.getByLabel('Onboarding ID').fill(onboardingId);
    await page.getByRole('button', { name: 'Apply' }).click();
  });

  await expect(page.getByRole('table', { name: 'Admin onboardings' })).toBeVisible();

  await expect
    .poll(() => measureHorizontalOverflow(page), {
      message: 'table should not overflow the page horizontally at desktop width',
    })
    .toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 375, height: 800 });

  await expect
    .poll(() => measureHorizontalOverflow(page), {
      message: 'table should not overflow the page horizontally at narrow width',
    })
    .toBeLessThanOrEqual(1);
});
