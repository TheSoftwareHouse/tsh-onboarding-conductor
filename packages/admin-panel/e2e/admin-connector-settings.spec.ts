import { expect, test, type Page } from '@playwright/test';

const APP_URL = process.env.BASE_URL || 'http://localhost:5173';
const ENGINE_BASE_URL = process.env.VITE_ENGINE_API_BASE_URL;

if (!ENGINE_BASE_URL) {
  throw new Error('VITE_ENGINE_API_BASE_URL must be provided to the admin-panel Playwright suite.');
}

const ENGINE_ORIGIN = new URL(ENGINE_BASE_URL).origin;
const CONNECTOR_SETTINGS_URL = `${ENGINE_ORIGIN}/v1/admin/connectors`;
const SAVED_MESSAGE = 'Saved. The new values are used from the next connector call onwards.';

class AdminConnectorsPage {
  constructor(readonly page: Page) {}

  get connectorsTab() {
    return this.page.getByRole('link', { name: 'Connectors' });
  }

  get statusRegion() {
    return this.page.getByRole('status').first();
  }

  form(label: string) {
    return this.page.getByRole('form', { name: label });
  }

  async open(): Promise<void> {
    await this.page.goto(APP_URL);
    await this.connectorsTab.click();
    await expect(this.statusRegion).toHaveText('Showing 2 configurable connectors.');
  }
}

test.describe('admin connector settings', () => {
  // The fixture engine holds the settings in memory the way the engine's table does, so a save in
  // one test is visible to the next. Running them in order keeps that shared state readable.
  test.describe.configure({ mode: 'serial' });

  test('should reach the connectors tab and report where each value comes from', async ({
    page,
  }) => {
    const app = new AdminConnectorsPage(page);
    await app.open();

    const sendgrid = app.form('SendGrid email');
    await expect(sendgrid.getByLabel(/API key/)).toHaveValue('');
    await expect(sendgrid.getByLabel(/API key/)).toHaveAttribute(
      'placeholder',
      'Set in the engine environment',
    );
    await expect(sendgrid.getByLabel(/Sender address/)).toHaveValue('ops@example.com');
    await expect(app.form('SMTP')).toContainText('The connector cannot run until this is set.');
    await expect(sendgrid.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  test('should save an edited credential and show it stored without reading it back', async ({
    page,
  }) => {
    const app = new AdminConnectorsPage(page);
    await app.open();

    const sendgrid = app.form('SendGrid email');
    const request = page.waitForRequest(
      (candidate) =>
        candidate.method() === 'PUT' &&
        candidate.url() === `${CONNECTOR_SETTINGS_URL}/sendgrid_email`,
    );

    await sendgrid.getByLabel(/API key/).fill('SG.rotated-by-playwright');
    await sendgrid.getByRole('button', { name: 'Save changes' }).click();

    expect((await request).postDataJSON()).toEqual({
      values: { apiKey: 'SG.rotated-by-playwright' },
    });
    await expect(sendgrid).toContainText(SAVED_MESSAGE);
    // The engine reports a stored secret as saved and nothing more, so the input goes back to empty.
    await expect(sendgrid.getByLabel(/API key/)).toHaveValue('');
    await expect(sendgrid).toContainText('Saved here');
    // Nothing was submitted for the connector next to it, so it reports nothing.
    await expect(app.form('SMTP')).not.toContainText(SAVED_MESSAGE);
  });

  test('should hand a setting back to the engine environment when it is cleared', async ({
    page,
  }) => {
    const app = new AdminConnectorsPage(page);
    await app.open();

    const sendgrid = app.form('SendGrid email');
    await sendgrid.getByLabel(/Sender address/).fill('');
    await expect(sendgrid).toContainText('Saving removes the stored value.');
    await sendgrid.getByRole('button', { name: 'Save changes' }).click();

    await expect(sendgrid).toContainText(SAVED_MESSAGE);
    await expect(sendgrid.getByLabel(/Sender address/)).toHaveValue('');
    await expect(sendgrid).toContainText('Not set');
  });
});
