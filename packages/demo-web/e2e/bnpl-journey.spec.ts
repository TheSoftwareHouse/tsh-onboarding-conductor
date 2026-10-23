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

const TEST_BANK = 'Algoan Demo Bank';

/** Posts the session-creating request of the "Start a credit check" button. */
async function startSession(page: Page): Promise<CreatedSession> {
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
  await expect(page.getByLabel('First name')).toHaveValue('');
  await page.getByLabel('First name').fill(first);
  await page.getByLabel('Last name').fill(last);
  await page.getByLabel('Email').fill(`${first}.${last}@example.com`.toLowerCase());
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function giveConsent(page: Page): Promise<void> {
  await expect(page.getByText('Share your bank data', { exact: true })).toBeVisible();
  await page.getByLabel(CONSENT_LABEL).click();
  await page.getByRole('button', { name: 'Continue to your bank' }).click();
}

/** Bank selection -> the bank's login. `profile` is clicked unless the session preselects one. */
async function connectBank(page: Page, profile: string | null): Promise<void> {
  await expect(page.getByText('Select your bank', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: TEST_BANK }).click();

  await expect(page.getByText('Sign in to connect your accounts')).toBeVisible();
  if (profile === null) {
    await expect(page.getByRole('radio', { checked: true })).toBeVisible();
  } else {
    await page.getByRole('radio', { name: profile }).check();
  }

  // The password is required, any value; the button only opens once it is filled.
  const connect = page.getByRole('button', { name: 'Connect bank' });

  await expect(connect).toBeDisabled();
  await page.getByLabel('Password').fill('any password');
  await connect.click();

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

/** The whole journey from `/` to processing, signing in to the bank as `profile`. */
async function runUntilProcessing(page: Page, profile: string): Promise<CreatedSession> {
  const session = await startSession(page);

  expect(session.persona).toBeNull();
  await fillDetails(page, 'Jane', 'Doe');
  await giveConsent(page);
  await connectBank(page, profile);
  await authoriseAccounts(page);

  return session;
}

async function postMockCallback(request: APIRequestContext, onboardingId: string): Promise<void> {
  const response = await request.post(MOCK_CREDIT_CALLBACK, {
    data: { onboardingId, providerReference: `mock:${onboardingId}:1` },
  });

  expect(response.ok()).toBe(true);
}

const SCENARIOS = [
  { profile: 'High score', decision: 'Approved', score: '965' },
  { profile: 'Medium score', decision: 'Under review', score: '598' },
  { profile: 'Low score', decision: 'Declined', score: '362' },
] as const;

for (const { profile, decision, score } of SCENARIOS) {
  test(`should show ${decision} with score ${score} when the customer signs in with the ${profile} profile`, async ({
    page,
    request,
  }) => {
    const session = await runUntilProcessing(page, profile);

    await postMockCallback(request, await onboardingIdOf(request, session.token));

    const banner = page.getByRole('region', { name: 'Credit decision' });

    await expect(banner.getByRole('heading', { name: decision })).toBeVisible();
    await expect(banner.getByText(score, { exact: true })).toBeVisible();
  });
}

test('should offer no scenario before the bank login', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Start a credit check' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
  await expect(page.getByText('Sherlock Holmes')).toHaveCount(0);
});

test('should go from the bank selection straight to the bank login', async ({ page }) => {
  await startSession(page);
  await fillDetails(page, 'Jane', 'Doe');
  await giveConsent(page);

  await page.getByRole('button', { name: TEST_BANK }).click();

  await expect(page).toHaveURL(/\/s\/[^/]+\/bank\/login$/);
  await expect(page.getByText('Sign in to connect your accounts')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'High score' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Medium score' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Low score' })).toBeVisible();
});

test('should render every result tab for an approved check', async ({ page, request }) => {
  const session = await runUntilProcessing(page, 'High score');

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

/**
 * `Fail Case` is a test-only persona the bank does not offer, so it starts through its test
 * link, which preselects it at the bank.
 */
async function failCaseUntilRetry(page: Page, request: APIRequestContext): Promise<void> {
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/v1/bnpl/sessions') && response.request().method() === 'POST',
  );
  await page.goto('/start/fail_case');
  const session = (await (await created).json()) as CreatedSession;

  await expect(page.getByText('Your details', { exact: true })).toBeVisible();
  await page.getByLabel('First name').fill('Fail');
  await page.getByLabel('Last name').fill('Case');
  await page.getByLabel('Email').fill('fail.case@example.com');
  await page.getByRole('button', { name: 'Continue' }).click();
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

test('should give every start its own session token', async ({ page, context }) => {
  const first = await startSession(page);

  await expect(page).toHaveURL(new RegExp(`/s/${first.token}/details`));

  const second = await context.newPage();
  const other = await startSession(second);

  await expect(second).toHaveURL(new RegExp(`/s/${other.token}/details`));
  expect(other.token).not.toBe(first.token);
});
