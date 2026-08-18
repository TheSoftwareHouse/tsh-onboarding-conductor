import 'reflect-metadata';
import { AppConfig, validateConfig } from './app.config';

describe('validateConfig', () => {
  const baseConfig = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    ADMIN_PANEL_ORIGIN: 'http://localhost:5173',
    STORAGE_S3_ACCESS_KEY_ID: 'access-key',
    STORAGE_S3_SECRET_ACCESS_KEY: 'secret-key',
    WORKFLOWS_DIR: '/tmp/workflows',
    TWILIO_ACCOUNT_SID: 'AC1234567890',
    TWILIO_AUTH_TOKEN: 'auth-token',
    TWILIO_VERIFY_SERVICE_SID: 'VA1234567890',
    SENDGRID_API_KEY: 'sg-test-key',
    SENDGRID_FROM: 'no-reply@example.com',
  };

  it('accepts a missing WORKFLOWS_DIR value', () => {
    // WORKFLOWS_DIR is now one of three sources. An engine can run on built-in workflows alone,
    // so an absent user directory is valid; WorkflowRegistryService is what fails when the three
    // sources between them produce nothing.
    const configWithoutWorkflowsDir = { ...baseConfig };
    delete configWithoutWorkflowsDir.WORKFLOWS_DIR;

    expect(validateConfig(configWithoutWorkflowsDir).WORKFLOWS_DIR).toBeUndefined();
  });

  it('defaults FIXTURE_WORKFLOWS_ENABLED to disabled', () => {
    expect(validateConfig(baseConfig).FIXTURE_WORKFLOWS_ENABLED).toBe(false);
  });

  it('accepts FIXTURE_WORKFLOWS_ENABLED outside production', () => {
    expect(
      validateConfig({
        ...baseConfig,
        FIXTURE_WORKFLOWS_ENABLED: 'true',
        NODE_ENV: 'development',
      }).FIXTURE_WORKFLOWS_ENABLED,
    ).toBe(true);
  });

  it('refuses FIXTURE_WORKFLOWS_ENABLED under NODE_ENV=production', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        FIXTURE_WORKFLOWS_ENABLED: 'true',
        NODE_ENV: 'production',
      }),
    ).toThrow(/FIXTURE_WORKFLOWS_ENABLED must not be enabled when NODE_ENV=production/);
  });

  it.each([['WORKFLOWS_DIR'], ['EMAIL_TEMPLATES_DIR']])('treats a blank %s as unset', (key) => {
    // Compose interpolates an unset optional variable to an empty string, so blank has to mean
    // "not configured" rather than failing startup.
    expect(validateConfig({ ...baseConfig, [key]: '   ' })[key as 'WORKFLOWS_DIR']).toBeUndefined();
    expect(validateConfig({ ...baseConfig, [key]: '' })[key as 'WORKFLOWS_DIR']).toBeUndefined();
  });

  it('trims a configured EMAIL_TEMPLATES_DIR', () => {
    expect(
      validateConfig({ ...baseConfig, EMAIL_TEMPLATES_DIR: '  /srv/templates  ' })
        .EMAIL_TEMPLATES_DIR,
    ).toBe('/srv/templates');
  });

  it('accepts a non-empty WORKFLOWS_DIR value', () => {
    const config = validateConfig(baseConfig);

    expect(config).toBeInstanceOf(AppConfig);
    expect(config.WORKFLOWS_DIR).toBe('/tmp/workflows');
  });

  it('defaults SANDBOX_CONNECTORS_ENABLED to disabled', () => {
    expect(validateConfig(baseConfig).SANDBOX_CONNECTORS_ENABLED).toBe(false);
  });

  it('accepts SANDBOX_CONNECTORS_ENABLED outside production', () => {
    expect(
      validateConfig({ ...baseConfig, SANDBOX_CONNECTORS_ENABLED: 'true', NODE_ENV: 'development' })
        .SANDBOX_CONNECTORS_ENABLED,
    ).toBe(true);
  });

  it('refuses to enable sandbox connectors under NODE_ENV=production', () => {
    expect(() =>
      validateConfig({ ...baseConfig, SANDBOX_CONNECTORS_ENABLED: 'true', NODE_ENV: 'production' }),
    ).toThrow(/SANDBOX_CONNECTORS_ENABLED must not be enabled when NODE_ENV=production/);
  });

  it('rejects a blank TWILIO_ACCOUNT_SID value', () => {
    expect(() => validateConfig({ ...baseConfig, TWILIO_ACCOUNT_SID: '   ' })).toThrow(
      /TWILIO_ACCOUNT_SID/,
    );
  });

  it('rejects a blank TWILIO_AUTH_TOKEN value', () => {
    expect(() => validateConfig({ ...baseConfig, TWILIO_AUTH_TOKEN: '' })).toThrow(
      /TWILIO_AUTH_TOKEN/,
    );
  });

  it('rejects a malformed TWILIO_VERIFY_SERVICE_SID value', () => {
    expect(() =>
      validateConfig({ ...baseConfig, TWILIO_VERIFY_SERVICE_SID: 'SA1234567890' }),
    ).toThrow(/TWILIO_VERIFY_SERVICE_SID/);
  });

  it('rejects a blank SENDGRID_API_KEY value', () => {
    expect(() => validateConfig({ ...baseConfig, SENDGRID_API_KEY: '   ' })).toThrow(
      /SENDGRID_API_KEY/,
    );
  });

  it('rejects a malformed SENDGRID_FROM value', () => {
    expect(() => validateConfig({ ...baseConfig, SENDGRID_FROM: 'not-an-email' })).toThrow(
      /SENDGRID_FROM/,
    );
  });

  it('accepts trimmed SendGrid values', () => {
    const config = validateConfig({
      ...baseConfig,
      SENDGRID_API_KEY: '  sg-test-key  ',
      SENDGRID_FROM: '  no-reply@example.com  ',
    });

    expect(config.SENDGRID_API_KEY).toBe('sg-test-key');
    expect(config.SENDGRID_FROM).toBe('no-reply@example.com');
  });

  it('rejects a TWILIO_VERIFY_TIMEOUT_MS value outside the allowed bounds', () => {
    expect(() => validateConfig({ ...baseConfig, TWILIO_VERIFY_TIMEOUT_MS: 99 })).toThrow(
      /TWILIO_VERIFY_TIMEOUT_MS/,
    );
  });

  it('accepts valid Twilio configuration and defaults the timeout', () => {
    const config = validateConfig(baseConfig);

    expect(config.TWILIO_ACCOUNT_SID).toBe('AC1234567890');
    expect(config.TWILIO_AUTH_TOKEN).toBe('auth-token');
    expect(config.TWILIO_VERIFY_SERVICE_SID).toBe('VA1234567890');
    expect(config.TWILIO_VERIFY_TIMEOUT_MS).toBe(10000);
  });

  it('defaults the http connector timeout and secrets', () => {
    const config = validateConfig(baseConfig);

    expect(config.HTTP_CONNECTOR_TIMEOUT_MS).toBe(5000);
    expect(config.HTTP_CONNECTOR_SECRETS).toBe('{}');
  });

  it('coerces HTTP_CONNECTOR_TIMEOUT_MS from a string and enforces its bounds', () => {
    expect(
      validateConfig({ ...baseConfig, HTTP_CONNECTOR_TIMEOUT_MS: '1500' })
        .HTTP_CONNECTOR_TIMEOUT_MS,
    ).toBe(1500);
    expect(() => validateConfig({ ...baseConfig, HTTP_CONNECTOR_TIMEOUT_MS: '99' })).toThrow(
      /HTTP_CONNECTOR_TIMEOUT_MS/,
    );
    expect(() => validateConfig({ ...baseConfig, HTTP_CONNECTOR_TIMEOUT_MS: '30001' })).toThrow(
      /HTTP_CONNECTOR_TIMEOUT_MS/,
    );
  });

  it('accepts a well-formed HTTP_CONNECTOR_SECRETS blob', () => {
    const config = validateConfig({
      ...baseConfig,
      HTTP_CONNECTOR_SECRETS: '{"kycProvider":{"token":"abc"}}',
    });

    expect(config.HTTP_CONNECTOR_SECRETS).toBe('{"kycProvider":{"token":"abc"}}');
  });

  it('rejects a malformed HTTP_CONNECTOR_SECRETS blob', () => {
    expect(() => validateConfig({ ...baseConfig, HTTP_CONNECTOR_SECRETS: '{not json' })).toThrow(
      'HTTP_CONNECTOR_SECRETS must be valid JSON',
    );
    expect(() =>
      validateConfig({ ...baseConfig, HTTP_CONNECTOR_SECRETS: '{"kycProvider":{"ttl":30}}' }),
    ).toThrow('HTTP_CONNECTOR_SECRETS.kycProvider.ttl must be a string');
  });

  it('keeps SMTP disabled by default', () => {
    const config = validateConfig(baseConfig);

    expect(config.SMTP_ENABLED).toBe(false);
  });

  it('accepts valid MailHog SMTP settings when enabled', () => {
    const config = validateConfig({
      ...baseConfig,
      SMTP_ENABLED: true,
      SMTP_HOST: 'mailhog',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      SMTP_STARTTLS: false,
      SMTP_FROM: 'sender@example.com',
      SMTP_TIMEOUT_MS: 3000,
    });

    expect(config.SMTP_ENABLED).toBe(true);
    expect(config.SMTP_HOST).toBe('mailhog');
    expect(config.SMTP_PORT).toBe(1025);
    expect(config.SMTP_SECURE).toBe(false);
    expect(config.SMTP_STARTTLS).toBe(false);
    expect(config.SMTP_FROM).toBe('sender@example.com');
    expect(config.SMTP_TIMEOUT_MS).toBe(3000);
  });

  it('rejects SMTP plaintext settings for non-MailHog hosts', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        SMTP_ENABLED: true,
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
      }),
    ).toThrow(/SMTP_SECURE|SMTP_STARTTLS|SMTP_HOST/);
  });

  it('rejects contradictory SMTP TLS combinations', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        SMTP_ENABLED: true,
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        SMTP_SECURE: true,
        SMTP_STARTTLS: true,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
      }),
    ).toThrow(/SMTP_SECURE|SMTP_STARTTLS/);
  });

  it('rejects SMTP ports and timeouts outside the supported bounds', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 0,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 50,
      }),
    ).toThrow(/SMTP_PORT|SMTP_TIMEOUT_MS/);
  });

  it('requires paired SMTP credentials when either is provided', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
        SMTP_USERNAME: 'smtp-user',
      }),
    ).toThrow(/SMTP_USERNAME|SMTP_PASSWORD/);
  });

  it('coerces SMTP boolean settings from strings', () => {
    const config = validateConfig({
      ...baseConfig,
      SMTP_ENABLED: true,
      SMTP_HOST: 'mailhog',
      SMTP_PORT: 1025,
      SMTP_SECURE: 'false',
      SMTP_STARTTLS: 'true',
      SMTP_FROM: 'sender@example.com',
      SMTP_TIMEOUT_MS: 3000,
    });

    expect(config.SMTP_SECURE).toBe(false);
    expect(config.SMTP_STARTTLS).toBe(true);
  });

  it('coerces STORAGE_S3_FORCE_PATH_STYLE from string false to boolean false', () => {
    const config = validateConfig({
      ...baseConfig,
      WORKFLOWS_DIR: '/tmp/workflows',
      STORAGE_S3_FORCE_PATH_STYLE: 'false',
    });

    expect(config.STORAGE_S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('coerces STORAGE_S3_FORCE_PATH_STYLE from string true to boolean true', () => {
    const config = validateConfig({
      ...baseConfig,
      WORKFLOWS_DIR: '/tmp/workflows',
      STORAGE_S3_FORCE_PATH_STYLE: 'true',
    });

    expect(config.STORAGE_S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('keeps client webhook disabled when base URL is not configured', () => {
    const config = validateConfig(baseConfig);

    expect(config.CLIENT_WEBHOOK_BASE_URL).toBeUndefined();
    expect(config.CLIENT_WEBHOOK_TIMEOUT_MS).toBe(5000);
  });

  it('accepts a loopback HTTP endpoint in development', () => {
    const config = validateConfig({
      ...baseConfig,
      NODE_ENV: 'development',
      CLIENT_WEBHOOK_BASE_URL: 'http://localhost:8080/hooks/client',
      CLIENT_WEBHOOK_SIGNING_SECRETS: '{"2026-08":"signing-secret-with-enough-entropy"}',
      CLIENT_WEBHOOK_TIMEOUT_MS: 2500,
    });

    expect(config.CLIENT_WEBHOOK_BASE_URL).toBe('http://localhost:8080/hooks/client/');
    expect(config.CLIENT_WEBHOOK_TIMEOUT_MS).toBe(2500);
  });

  it('accepts a loopback IPv6 HTTP endpoint in development', () => {
    const config = validateConfig({
      ...baseConfig,
      NODE_ENV: 'development',
      CLIENT_WEBHOOK_BASE_URL: 'http://[::1]:8080/hooks/client',
      CLIENT_WEBHOOK_SIGNING_SECRETS: '{"2026-08":"signing-secret-with-enough-entropy"}',
    });

    expect(config.CLIENT_WEBHOOK_BASE_URL).toBe('http://[::1]:8080/hooks/client/');
  });

  it('accepts a loopback HTTP endpoint in test mode', () => {
    const config = validateConfig({
      ...baseConfig,
      NODE_ENV: 'test',
      CLIENT_WEBHOOK_BASE_URL: 'http://127.0.0.1:9999/webhook',
      CLIENT_WEBHOOK_SIGNING_SECRETS: '{"2026-08":"signing-secret-with-enough-entropy"}',
    });

    expect(config.CLIENT_WEBHOOK_BASE_URL).toBe('http://127.0.0.1:9999/webhook/');
  });

  it('rejects malformed client webhook base URL', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        CLIENT_WEBHOOK_BASE_URL: 'not-a-url',
      }),
    ).toThrow(/CLIENT_WEBHOOK_BASE_URL/);
  });

  it('rejects client webhook base URL with credentials', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        CLIENT_WEBHOOK_BASE_URL: 'https://user:pass@example.com/webhook',
      }),
    ).toThrow(/CLIENT_WEBHOOK_BASE_URL/);
  });

  it('rejects client webhook base URL with fragment', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        CLIENT_WEBHOOK_BASE_URL: 'https://example.com/webhook#fragment',
      }),
    ).toThrow(/CLIENT_WEBHOOK_BASE_URL/);
  });

  it('rejects client webhook URL with query parameters', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        CLIENT_WEBHOOK_BASE_URL: 'https://example.com/webhook?token=abc',
      }),
    ).toThrow(/query parameters/);
  });

  it('rejects non-loopback HTTP endpoint even in development', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        NODE_ENV: 'development',
        CLIENT_WEBHOOK_BASE_URL: 'http://example.com/webhook',
      }),
    ).toThrow(/loopback/);
  });

  it('rejects HTTP endpoint in production', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        NODE_ENV: 'production',
        CLIENT_WEBHOOK_BASE_URL: 'http://localhost:8080/webhook',
      }),
    ).toThrow(/HTTPS in production/);
  });

  it('rejects invalid client webhook timeout value', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        CLIENT_WEBHOOK_TIMEOUT_MS: 0,
      }),
    ).toThrow(/CLIENT_WEBHOOK_TIMEOUT_MS/);
  });

  it('accepts a valid ADMIN_PANEL_ORIGIN value', () => {
    const config = validateConfig({
      ...baseConfig,
      WORKFLOWS_DIR: '/tmp/workflows',
      ADMIN_PANEL_ORIGIN: 'http://localhost:5173',
    });

    expect(config).toBeInstanceOf(AppConfig);
    expect(config.ADMIN_PANEL_ORIGIN).toBe('http://localhost:5173');
  });

  it('trims surrounding whitespace from ADMIN_PANEL_ORIGIN value', () => {
    const config = validateConfig({
      ...baseConfig,
      WORKFLOWS_DIR: '/tmp/workflows',
      ADMIN_PANEL_ORIGIN: '  http://localhost:5173  ',
    });

    expect(config).toBeInstanceOf(AppConfig);
    expect(config.ADMIN_PANEL_ORIGIN).toBe('http://localhost:5173');
  });

  it('rejects a missing ADMIN_PANEL_ORIGIN value', () => {
    const configWithoutAdminPanelOrigin = { ...baseConfig };
    delete configWithoutAdminPanelOrigin.ADMIN_PANEL_ORIGIN;

    expect(() =>
      validateConfig({
        ...configWithoutAdminPanelOrigin,
        WORKFLOWS_DIR: '/tmp/workflows',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects a blank ADMIN_PANEL_ORIGIN value', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        WORKFLOWS_DIR: '/tmp/workflows',
        ADMIN_PANEL_ORIGIN: '   ',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects an ADMIN_PANEL_ORIGIN value with a wrong protocol', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        WORKFLOWS_DIR: '/tmp/workflows',
        ADMIN_PANEL_ORIGIN: 'ftp://localhost:5173',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects an ADMIN_PANEL_ORIGIN value with embedded credentials', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        WORKFLOWS_DIR: '/tmp/workflows',
        ADMIN_PANEL_ORIGIN: 'http://user:pass@localhost:5173',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects an ADMIN_PANEL_ORIGIN value with a path', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        WORKFLOWS_DIR: '/tmp/workflows',
        ADMIN_PANEL_ORIGIN: 'http://localhost:5173/path',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects an ADMIN_PANEL_ORIGIN value with a query string', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        WORKFLOWS_DIR: '/tmp/workflows',
        ADMIN_PANEL_ORIGIN: 'http://localhost:5173?query=1',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects an ADMIN_PANEL_ORIGIN value with a fragment', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        WORKFLOWS_DIR: '/tmp/workflows',
        ADMIN_PANEL_ORIGIN: 'http://localhost:5173#fragment',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects an ADMIN_PANEL_ORIGIN value with a trailing slash', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        WORKFLOWS_DIR: '/tmp/workflows',
        ADMIN_PANEL_ORIGIN: 'http://localhost:5173/',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('applies default worker settings', () => {
    const config = validateConfig(baseConfig);

    expect(config.WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS).toBe(1000);
    expect(config.WEBHOOK_OUTBOX_WORKER_BATCH_SIZE).toBe(25);
    expect(config.WEBHOOK_OUTBOX_WORKER_LEASE_MS).toBe(60000);
  });

  it('applies default queue settings', () => {
    const config = validateConfig(baseConfig);

    expect(config.WEBHOOK_OUTBOX_QUEUE_NAME).toBe('webhook-outbox');
    expect(config.WEBHOOK_OUTBOX_QUEUE_CONCURRENCY).toBe(4);
  });

  it('rejects a blank queue name', () => {
    expect(() => validateConfig({ ...baseConfig, WEBHOOK_OUTBOX_QUEUE_NAME: '   ' })).toThrow(
      /WEBHOOK_OUTBOX_QUEUE_NAME/,
    );
  });

  it('rejects a queue concurrency below the minimum', () => {
    expect(() => validateConfig({ ...baseConfig, WEBHOOK_OUTBOX_QUEUE_CONCURRENCY: 0 })).toThrow(
      /WEBHOOK_OUTBOX_QUEUE_CONCURRENCY/,
    );
  });

  it('accepts valid worker settings', () => {
    const config = validateConfig({
      ...baseConfig,
      WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS: 2000,
      WEBHOOK_OUTBOX_WORKER_BATCH_SIZE: 10,
      WEBHOOK_OUTBOX_WORKER_LEASE_MS: 30000,
    });

    expect(config.WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS).toBe(2000);
    expect(config.WEBHOOK_OUTBOX_WORKER_BATCH_SIZE).toBe(10);
    expect(config.WEBHOOK_OUTBOX_WORKER_LEASE_MS).toBe(30000);
  });

  it('rejects a worker poll interval below the minimum', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS: 50,
      }),
    ).toThrow(/WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS/);
  });

  it('rejects a worker batch size below the minimum', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        WEBHOOK_OUTBOX_WORKER_BATCH_SIZE: 0,
      }),
    ).toThrow(/WEBHOOK_OUTBOX_WORKER_BATCH_SIZE/);
  });

  it('rejects a worker batch size above the maximum', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        WEBHOOK_OUTBOX_WORKER_BATCH_SIZE: 1001,
      }),
    ).toThrow(/WEBHOOK_OUTBOX_WORKER_BATCH_SIZE/);
  });

  it('rejects a worker lease below the minimum', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        WEBHOOK_OUTBOX_WORKER_LEASE_MS: 500,
      }),
    ).toThrow(/WEBHOOK_OUTBOX_WORKER_LEASE_MS/);
  });

  it('rejects a worker lease shorter than timeout plus grace', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        CLIENT_WEBHOOK_TIMEOUT_MS: 10000,
        WEBHOOK_OUTBOX_WORKER_LEASE_MS: 14000,
      }),
    ).toThrow(
      /WEBHOOK_OUTBOX_WORKER_LEASE_MS must be at least CLIENT_WEBHOOK_TIMEOUT_MS \+ 5000 ms/,
    );
  });

  it('accepts a worker lease equal to timeout plus grace', () => {
    const config = validateConfig({
      ...baseConfig,
      CLIENT_WEBHOOK_TIMEOUT_MS: 10000,
      WEBHOOK_OUTBOX_WORKER_LEASE_MS: 15000,
    });

    expect(config.WEBHOOK_OUTBOX_WORKER_LEASE_MS).toBe(15000);
  });

  describe('CLIENT_WEBHOOK_SIGNING_SECRETS', () => {
    const signingSecret = 'signing-secret-with-enough-entropy';

    it('rejects an outbound webhook base url without a signing key', () => {
      expect(() =>
        validateConfig({
          ...baseConfig,
          CLIENT_WEBHOOK_BASE_URL: 'https://client.example/webhooks/',
        }),
      ).toThrow(/CLIENT_WEBHOOK_SIGNING_SECRETS is required/);
    });

    it('accepts an outbound webhook base url with a signing key', () => {
      const config = validateConfig({
        ...baseConfig,
        CLIENT_WEBHOOK_BASE_URL: 'https://client.example/webhooks/',
        CLIENT_WEBHOOK_SIGNING_SECRETS: `{"2026-08":"${signingSecret}"}`,
      });

      expect(config.CLIENT_WEBHOOK_SIGNING_SECRETS).toBe(`{"2026-08":"${signingSecret}"}`);
    });

    it('allows omitting signing keys when no outbound webhook base url is configured', () => {
      expect(() => validateConfig(baseConfig)).not.toThrow();
    });

    it('rejects malformed signing keys', () => {
      expect(() =>
        validateConfig({
          ...baseConfig,
          CLIENT_WEBHOOK_BASE_URL: 'https://client.example/webhooks/',
          CLIENT_WEBHOOK_SIGNING_SECRETS: '{"2026-08":"too-short"}',
        }),
      ).toThrow(/must be at least 32 characters/);
    });
  });
});
