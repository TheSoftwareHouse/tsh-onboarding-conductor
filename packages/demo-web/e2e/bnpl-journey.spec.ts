import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// The fixture workflow runs on `mock_credit`, which answers once its callback is posted.
const ENGINE_BASE_URL = process.env.ENGINE_BASE_URL ?? 'http://localhost:3000';
const MOCK_CREDIT_CALLBACK = `${ENGINE_BASE_URL}/v1/webhooks/mock_credit/callback`;
const CONSENT_LABEL = /I agree to the open-banking credit check/;

const BFF_ORIGIN = 'http://localhost:3101';

interface CreatedSession {
  token: string;
  persona: string | null;
}

/** The BFF's test-only route (`NODE_ENV=test`); the public response carries no engine id. */
async function onboardingIdOf(request: APIRequestContext, token: string): Promise<string> {
  const response = await request.get(`${BFF_ORIGIN}/v1/bnpl/sessions/${token}/onboarding`);
  expect(response.ok()).toBe(true);

  return ((await response.json()) as { onboardingId: string }).onboardingId;
}

/** Clicks Start on a persona card and returns the session the BFF created for it. */
async function startFromCard(page: Page, personaId: string): Promise<CreatedSession> {
  await page.goto('/');

  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/v1/bnpl/sessions') && response.request().method() === 'POST',
  );

  await page.getByTestId(`persona-${personaId}`).getByRole('button', { name: 'Start' }).click();

  return (await (await created).json()) as CreatedSession;
}

const TEST_BANK = 'Algoan Demo Bank';

/** Posts the session-creating request of the generic "Start a credit check" button. */
async function startGeneric(page: Page): Promise<CreatedSession> {
  await page.goto('/');

  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/v1/bnpl/sessions') && response.request().method() === 'POST',
  );

  await page.getByRole('button', { name: 'Start a credit check' }).click();

  return (await (await created).json()) as CreatedSession;
}

async function fillDetails(page: Page, first: string, last: string): Promise<void> {
  await expect(page.getByText('Your details', { exact: true })).toBeVisible();
  await page.getByLabel('First name').fill(first);
  await page.getByLabel('Last name').fill(last);
  await page.getByLabel('Email').fill(`${first}.${last}@example.com`.toLowerCase());
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function giveConsent(page: Page): Promise<void> {
  await expect(page.getByText('Share your bank data', { exact: true })).toBeVisible();
  await page.getByLabel(CONSENT_LABEL).click();
  await page.getByRole('button', { name: 'Go to bank selection' }).click();
}

/** Bank selection -> device authentication -> login. `profile` is clicked unless preselected. */
async function connectBank(page: Page, profile: string | null): Promise<void> {
  await expect(page.getByText('Select your bank', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: TEST_BANK }).click();

  await expect(page.getByText(`Authenticate with the ${TEST_BANK} app`)).toBeVisible();
  await page.getByRole('link', { name: 'Continue on this device' }).click();

  await expect(page.getByText('Sign in to connect your accounts')).toBeVisible();
  if (profile === null) {
    await expect(page.getByRole('radio', { checked: true })).toBeVisible();
  } else {
    await page.getByRole('radio', { name: new RegExp(profile) }).check();
  }
  await page.getByRole('button', { name: 'Connect bank' }).click();

  await expect(page.getByText('Transmission in progress…', { exact: true })).toBeVisible();
}

/** Accounts (all of them) -> the bank's authorisation page -> processing. */
async function authoriseAccounts(page: Page, savings = true): Promise<void> {
  await expect(page.getByText('Select accounts for analysis', { exact: true })).toBeVisible();
  await page.getByLabel('Select all accounts').click();
  await expect(page.getByLabel('Current account')).toBeChecked();
  if (savings) {
    await expect(page.getByLabel('Savings account')).toBeChecked();
  }
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect(page.getByText('Algoan wants to access:')).toBeVisible();
  await page.getByRole('button', { name: 'Authorise access' }).click();
  await expect(page.getByText('Analysing your accounts', { exact: true })).toBeVisible();
}

/** From the prefilled details page to processing; `profile` as in `connectBank`. */
async function runUntilProcessing(page: Page, profile: string | null = null): Promise<void> {
  await expect(page.getByText('Your details', { exact: true })).toBeVisible();
  await expect(page.getByLabel('First name')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Continue' }).click();

  await giveConsent(page);
  await connectBank(page, profile);
  await authoriseAccounts(page);
}

async function postMockCallback(request: APIRequestContext, onboardingId: string): Promise<void> {
  const response = await request.post(MOCK_CREDIT_CALLBACK, {
    data: { onboardingId, providerReference: `mock:${onboardingId}:1` },
  });

  expect(response.ok()).toBe(true);
}

const SCENARIOS = [
  { persona: 'james_watson', decision: 'Under review', score: '598' },
  { persona: 'james_moriarty', decision: 'Declined', score: '362' },
] as const;

for (const { persona, decision, score } of SCENARIOS) {
  test(`should show ${decision} with score ${score} when the ${persona} shortcut finishes the credit check`, async ({
    page,
    request,
  }) => {
    const session = await startFromCard(page, persona);

    await runUntilProcessing(page);
    await postMockCallback(request, await onboardingIdOf(request, session.token));

    const banner = page.getByRole('region', { name: 'Credit decision' });

    await expect(banner.getByRole('heading', { name: decision })).toBeVisible();
    await expect(banner.getByText(score, { exact: true })).toBeVisible();
  });
}

test('should show Approved with score 965 when the generic journey picks the high profile', async ({
  page,
  request,
}) => {
  const session = await startGeneric(page);

  expect(session.persona).toBeNull();
  await expect(page.getByLabel('First name')).toHaveValue('');
  await fillDetails(page, 'Sherlock', 'Holmes');
  await giveConsent(page);
  await connectBank(page, 'High score');
  await authoriseAccounts(page);
  await postMockCallback(request, await onboardingIdOf(request, session.token));

  const banner = page.getByRole('region', { name: 'Credit decision' });

  await expect(banner.getByRole('heading', { name: 'Approved' })).toBeVisible();
  await expect(banner.getByText('965', { exact: true })).toBeVisible();
});

test('should render a QR code on the bank authentication page', async ({ page }) => {
  await startGeneric(page);
  await fillDetails(page, 'Sherlock', 'Holmes');
  await giveConsent(page);
  await page.getByRole('button', { name: TEST_BANK }).click();

  await expect(page.getByText(`Authenticate with the ${TEST_BANK} app`)).toBeVisible();
  await expect(page.locator('svg:has(> title) path').first()).toBeAttached();
});

test('should render every result tab without an error when Sherlock is approved', async ({
  page,
  request,
}) => {
  const session = await startFromCard(page, 'sherlock_holmes');

  await runUntilProcessing(page);
  await postMockCallback(request, await onboardingIdOf(request, session.token));

  await expect(
    page
      .getByRole('region', { name: 'Credit decision' })
      .getByRole('heading', { name: 'Approved' }),
  ).toBeVisible();

  const results = page.getByTestId('result-tabs');
  const panel = results.getByRole('tabpanel');

  async function openTab(name: string): Promise<void> {
    await results.getByRole('tab', { name, exact: true }).first().click();
    await expect(panel.first()).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Approved' })).toBeVisible();
  }

  await openTab('Credit Score');
  await openTab('Payment Score');
  await openTab('Credit Insights');
  for (const sub of ['Categories', 'Indicators', 'Transactions']) {
    await openTab(sub);
  }
  await openTab('Accounts');
  await expect(page.getByRole('cell', { name: 'Algoan Demo', exact: true })).toHaveCount(2);
  await expect(page.getByRole('cell', { name: 'Savings account' })).toBeVisible();
  await openTab('Raw JSON');
  await expect(panel.filter({ visible: true })).toContainText('creditScore');
});

/** `Fail Case` is a test-only persona with no card, so it starts through its start link. */
async function failCaseUntilRetry(page: Page, request: APIRequestContext): Promise<void> {
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/v1/bnpl/sessions') && response.request().method() === 'POST',
  );
  await page.goto('/start/fail_case');
  const session = (await (await created).json()) as CreatedSession;

  await fillDetails(page, 'Fail', 'Case');
  await giveConsent(page);
  await connectBank(page, null);
  // The test-only persona owns a current account only.
  await authoriseAccounts(page, false);

  await postMockCallback(request, await onboardingIdOf(request, session.token));

  await expect(page.getByText('Select accounts for analysis', { exact: true })).toBeVisible();
}

test('should return to the account selection when the provider fails the analysis', async ({
  page,
  request,
}) => {
  await failCaseUntilRetry(page, request);

  await expect(page.getByRole('status')).toContainText('The credit check could not finish');
  await expect(page).toHaveURL(/\/s\/[^/]+\/accounts$/);
});

// BUG: the engine's `credit-assessment` step type declares `creditAttemptCount` without
// `clientVisible: true` (packages/shared/ddl-schema/src/step-types/types/credit-assessment.step-type.ts),
// so `/state.data` omits it, the BFF sends no `attempt` and the notice reads "could not finish."
// with no "(attempt 1)".
test('should show the attempt number in the retry notice', async ({ page, request }) => {
  await failCaseUntilRetry(page, request);

  await expect(page.getByRole('status')).toContainText('(attempt 1)');
});

test('should open a second session with a different token when starting in a new tab', async ({
  page,
  context,
}) => {
  const first = await startFromCard(page, 'sherlock_holmes');

  await expect(page).toHaveURL(new RegExp(`/s/${first.token}/details`));

  const second = await context.newPage();

  await second.goto('/');

  const popup = second.waitForEvent('popup');

  await second
    .getByTestId('persona-sherlock_holmes')
    .getByRole('link', { name: 'Start in a new tab' })
    .click();

  const opened = await popup;

  await expect(opened).toHaveURL(/\/s\/[^/]+\/details/);

  const token = /\/s\/([^/]+)\/details/.exec(opened.url())?.[1];

  expect(token).toBeTruthy();
  expect(token).not.toBe(first.token);
});
