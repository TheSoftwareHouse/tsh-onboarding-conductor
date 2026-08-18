/**
 * Configuration `AppConfig` requires but which most suites do not exercise.
 *
 * These used to arrive implicitly: `ConfigModule` listed `.env.dist` as the last entry in its
 * `envFilePath`, so any checkout supplied development values even when nothing configured them.
 * That made suite behaviour depend on a file's contents — the same leak that let the fixture
 * workflow source switch itself on inside suites that had supplied their own workflows.
 *
 * Call this first in a suite's environment setup, then override whatever the suite actually
 * asserts on. Later assignments win, so a suite that cares about, say, ADMIN_PANEL_ORIGIN simply
 * sets it afterwards.
 */
export const applyRequiredTestConfig = (): void => {
  process.env.ADMIN_PANEL_ORIGIN = 'http://localhost:5173';
  process.env.SENDGRID_API_KEY = 'sg-e2e-test-key';
  process.env.SENDGRID_FROM = 'no-reply@example.com';
  process.env.TWILIO_ACCOUNT_SID = 'ACtest';
  process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
  process.env.TWILIO_VERIFY_SERVICE_SID = 'VA0000000000000000000000000000000';
};
