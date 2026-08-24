import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppConfig,
  DEVELOPMENT_CONNECTOR_SETTINGS_ENCRYPTION_KEY,
  validateConfig,
} from './app.config';

describe('validateConfig', () => {
  const baseConfig = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    ADMIN_PANEL_ORIGIN: 'http://localhost:5173',
    STORAGE_S3_ACCESS_KEY_ID: 'access-key',
    STORAGE_S3_SECRET_ACCESS_KEY: 'secret-key',
    TWILIO_ACCOUNT_SID: 'AC1234567890',
    TWILIO_AUTH_TOKEN: 'auth-token',
    TWILIO_VERIFY_SERVICE_SID: 'VA1234567890',
    SENDGRID_API_KEY: 'sg-test-key',
    SENDGRID_FROM: 'no-reply@example.com',
    // Off for the cases below, which are about other settings. The admin-auth rules have their
    // own block at the end of this file and set the flag themselves.
    ADMIN_AUTH_ENABLED: 'false',
  };

  const azureConfig = {
    AZURE_TENANT_ID: '11111111-1111-1111-1111-111111111111',
    AZURE_API_AUDIENCE: '22222222-2222-2222-2222-222222222222',
  };

  it('leaves WORKFLOWS_USERS_DIR unset when it is not provided', () => {
    expect(validateConfig(baseConfig).WORKFLOWS_USERS_DIR).toBeUndefined();
  });

  it('rejects a blank WORKFLOWS_USERS_DIR value', () => {
    expect(() => validateConfig({ ...baseConfig, WORKFLOWS_USERS_DIR: '   ' })).toThrow(
      /WORKFLOWS_USERS_DIR/,
    );
  });

  it('trims a provided WORKFLOWS_USERS_DIR value', () => {
    expect(
      validateConfig({ ...baseConfig, WORKFLOWS_USERS_DIR: '  /tmp/user-workflows  ' })
        .WORKFLOWS_USERS_DIR,
    ).toBe('/tmp/user-workflows');
  });

  it('leaves EMAIL_TEMPLATES_USERS_DIR unset when it is not provided', () => {
    expect(validateConfig(baseConfig).EMAIL_TEMPLATES_USERS_DIR).toBeUndefined();
  });

  it('rejects a blank EMAIL_TEMPLATES_USERS_DIR value', () => {
    expect(() => validateConfig({ ...baseConfig, EMAIL_TEMPLATES_USERS_DIR: '   ' })).toThrow(
      /EMAIL_TEMPLATES_USERS_DIR/,
    );
  });

  it('trims a provided EMAIL_TEMPLATES_USERS_DIR value', () => {
    expect(
      validateConfig({ ...baseConfig, EMAIL_TEMPLATES_USERS_DIR: '  /tmp/user-templates  ' })
        .EMAIL_TEMPLATES_USERS_DIR,
    ).toBe('/tmp/user-templates');
  });

  it('accepts the base configuration', () => {
    expect(validateConfig(baseConfig)).toBeInstanceOf(AppConfig);
  });

  // Provider credentials are also settable from the admin panel, so a deployment may legitimately
  // start without them; a blank value means unset rather than an empty credential.
  it('starts without the provider credentials, reading a blank value as unset', () => {
    const config = validateConfig({
      ...baseConfig,
      TWILIO_ACCOUNT_SID: '   ',
      TWILIO_AUTH_TOKEN: '',
      TWILIO_VERIFY_SERVICE_SID: '',
      SENDGRID_API_KEY: '   ',
      SENDGRID_FROM: '',
    });

    expect(config.TWILIO_ACCOUNT_SID).toBeUndefined();
    expect(config.TWILIO_AUTH_TOKEN).toBeUndefined();
    expect(config.TWILIO_VERIFY_SERVICE_SID).toBeUndefined();
    expect(config.SENDGRID_API_KEY).toBeUndefined();
    expect(config.SENDGRID_FROM).toBeUndefined();
  });

  it('rejects a malformed TWILIO_VERIFY_SERVICE_SID value', () => {
    expect(() =>
      validateConfig({ ...baseConfig, TWILIO_VERIFY_SERVICE_SID: 'SA1234567890' }),
    ).toThrow(/TWILIO_VERIFY_SERVICE_SID/);
  });

  it('accepts a 32-byte base64 CONNECTOR_SETTINGS_ENCRYPTION_KEY and leaves it unset otherwise', () => {
    const key = Buffer.alloc(32, 7).toString('base64');

    expect(
      validateConfig({ ...baseConfig, CONNECTOR_SETTINGS_ENCRYPTION_KEY: `  ${key}  ` })
        .CONNECTOR_SETTINGS_ENCRYPTION_KEY,
    ).toBe(key);
    expect(validateConfig(baseConfig).CONNECTOR_SETTINGS_ENCRYPTION_KEY).toBeUndefined();
  });

  it('rejects a CONNECTOR_SETTINGS_ENCRYPTION_KEY that is not 32 bytes', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        CONNECTOR_SETTINGS_ENCRYPTION_KEY: Buffer.alloc(16, 7).toString('base64'),
      }),
    ).toThrow(/CONNECTOR_SETTINGS_ENCRYPTION_KEY/);
  });

  it('refuses the .env.dist development encryption key when NODE_ENV=production', () => {
    // The sample file ships a real key so a fresh clone can store a secret at all, and sits on the
    // engine's env search path — a deployment that never set its own would otherwise encrypt every
    // stored credential under a value published with the source.
    expect(() =>
      validateConfig({
        ...baseConfig,
        NODE_ENV: 'production',
        ADMIN_AUTH_ENABLED: 'true',
        ...azureConfig,
        CONNECTOR_SETTINGS_ENCRYPTION_KEY: DEVELOPMENT_CONNECTOR_SETTINGS_ENCRYPTION_KEY,
      }),
    ).toThrow(/CONNECTOR_SETTINGS_ENCRYPTION_KEY/);
  });

  it('accepts the development encryption key outside production, and a generated one anywhere', () => {
    expect(
      validateConfig({
        ...baseConfig,
        CONNECTOR_SETTINGS_ENCRYPTION_KEY: DEVELOPMENT_CONNECTOR_SETTINGS_ENCRYPTION_KEY,
      }).CONNECTOR_SETTINGS_ENCRYPTION_KEY,
    ).toBe(DEVELOPMENT_CONNECTOR_SETTINGS_ENCRYPTION_KEY);

    const generated = Buffer.alloc(32, 9).toString('base64');
    expect(
      validateConfig({
        ...baseConfig,
        NODE_ENV: 'production',
        ADMIN_AUTH_ENABLED: 'true',
        ...azureConfig,
        CONNECTOR_SETTINGS_ENCRYPTION_KEY: generated,
      }).CONNECTOR_SETTINGS_ENCRYPTION_KEY,
    ).toBe(generated);
  });

  it('keeps the development key in step with the one .env.dist ships', () => {
    // The guard above compares against a literal, so a rotated sample file would silently stop
    // being refused in production.
    const envDist = readFileSync(join(__dirname, '../../../../.env.dist'), 'utf8');

    expect(envDist).toContain(
      `CONNECTOR_SETTINGS_ENCRYPTION_KEY=${DEVELOPMENT_CONNECTOR_SETTINGS_ENCRYPTION_KEY}`,
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

  it('defaults the connector callback signing secrets', () => {
    expect(validateConfig(baseConfig).CONNECTOR_CALLBACK_SIGNING_SECRETS).toBe('{}');
  });

  it('rejects a malformed CONNECTOR_CALLBACK_SIGNING_SECRETS blob', () => {
    expect(() =>
      validateConfig({ ...baseConfig, CONNECTOR_CALLBACK_SIGNING_SECRETS: '{not json' }),
    ).toThrow('CONNECTOR_CALLBACK_SIGNING_SECRETS must be valid JSON');
    expect(() =>
      validateConfig({ ...baseConfig, CONNECTOR_CALLBACK_SIGNING_SECRETS: '{"tsh_kyc":[]}' }),
    ).toThrow('CONNECTOR_CALLBACK_SIGNING_SECRETS.tsh_kyc must list at least one secret');
  });

  it('defaults to no unsigned-callback connector types', () => {
    expect(validateConfig(baseConfig).CONNECTOR_CALLBACK_UNSIGNED_TYPES).toBe('');
  });

  it('rejects a malformed CONNECTOR_CALLBACK_UNSIGNED_TYPES list', () => {
    expect(() =>
      validateConfig({ ...baseConfig, CONNECTOR_CALLBACK_UNSIGNED_TYPES: 'Acme_Kyc' }),
    ).toThrow('CONNECTOR_CALLBACK_UNSIGNED_TYPES entries must be lowercase connector types');
  });

  it('keeps SMTP disabled by default', () => {
    const config = validateConfig(baseConfig);

    expect(config.SMTP_ENABLED).toBe(false);
  });

  it('accepts TLS SMTP settings for any host when enabled', () => {
    const config = validateConfig({
      ...baseConfig,
      SMTP_ENABLED: true,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_STARTTLS: true,
      SMTP_FROM: 'sender@example.com',
      SMTP_TIMEOUT_MS: 3000,
    });

    expect(config.SMTP_ENABLED).toBe(true);
    expect(config.SMTP_HOST).toBe('smtp.example.com');
    expect(config.SMTP_PORT).toBe(587);
    expect(config.SMTP_SECURE).toBe(false);
    expect(config.SMTP_STARTTLS).toBe(true);
    expect(config.SMTP_FROM).toBe('sender@example.com');
    expect(config.SMTP_TIMEOUT_MS).toBe(3000);
  });

  it('accepts plaintext SMTP settings for any host once SMTP_ALLOW_INSECURE is set', () => {
    const config = validateConfig({
      ...baseConfig,
      SMTP_ENABLED: true,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      SMTP_STARTTLS: false,
      SMTP_ALLOW_INSECURE: true,
      SMTP_FROM: 'sender@example.com',
      SMTP_TIMEOUT_MS: 3000,
    });

    expect(config.SMTP_ALLOW_INSECURE).toBe(true);
  });

  it('rejects plaintext SMTP settings without SMTP_ALLOW_INSECURE, whatever the host', () => {
    for (const host of ['smtp.example.com', 'mailhog']) {
      expect(() =>
        validateConfig({
          ...baseConfig,
          SMTP_ENABLED: true,
          SMTP_HOST: host,
          SMTP_PORT: 587,
          SMTP_SECURE: false,
          SMTP_STARTTLS: false,
          SMTP_FROM: 'sender@example.com',
          SMTP_TIMEOUT_MS: 3000,
        }),
      ).toThrow(/SMTP_ALLOW_INSECURE/);
    }
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
        SMTP_ALLOW_INSECURE: true,
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
        SMTP_ALLOW_INSECURE: true,
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
      STORAGE_S3_FORCE_PATH_STYLE: 'false',
    });

    expect(config.STORAGE_S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('coerces STORAGE_S3_FORCE_PATH_STYLE from string true to boolean true', () => {
    const config = validateConfig({
      ...baseConfig,
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
    });

    expect(config.CLIENT_WEBHOOK_BASE_URL).toBe('http://[::1]:8080/hooks/client/');
  });

  it('accepts a loopback HTTP endpoint in test mode', () => {
    const config = validateConfig({
      ...baseConfig,
      NODE_ENV: 'test',
      CLIENT_WEBHOOK_BASE_URL: 'http://127.0.0.1:9999/webhook',
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
      ADMIN_PANEL_ORIGIN: 'http://localhost:5173',
    });

    expect(config).toBeInstanceOf(AppConfig);
    expect(config.ADMIN_PANEL_ORIGIN).toBe('http://localhost:5173');
  });

  it('trims surrounding whitespace from ADMIN_PANEL_ORIGIN value', () => {
    const config = validateConfig({
      ...baseConfig,
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
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects a blank ADMIN_PANEL_ORIGIN value', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        ADMIN_PANEL_ORIGIN: '   ',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects an ADMIN_PANEL_ORIGIN value with a wrong protocol', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        ADMIN_PANEL_ORIGIN: 'ftp://localhost:5173',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects an ADMIN_PANEL_ORIGIN value with embedded credentials', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        ADMIN_PANEL_ORIGIN: 'http://user:pass@localhost:5173',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects an ADMIN_PANEL_ORIGIN value with a path', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        ADMIN_PANEL_ORIGIN: 'http://localhost:5173/path',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects an ADMIN_PANEL_ORIGIN value with a query string', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        ADMIN_PANEL_ORIGIN: 'http://localhost:5173?query=1',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects an ADMIN_PANEL_ORIGIN value with a fragment', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        ADMIN_PANEL_ORIGIN: 'http://localhost:5173#fragment',
      }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('rejects an ADMIN_PANEL_ORIGIN value with a trailing slash', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
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

  it('keeps the connector mock pairs in every environment and rejects a malformed one', () => {
    const mocks = 'twilio_verify:mock_phone_verification';

    // Configuring the pairs is allowed anywhere; only a test run applies them, which the
    // connector registry decides rather than this validation.
    for (const nodeEnv of ['test', 'development', 'production']) {
      expect(
        validateConfig({
          ...baseConfig,
          ...azureConfig,
          // Production refuses to start with the admin-auth escape hatch open, which is a rule
          // of its own; this case is only about the mock pairs.
          ADMIN_AUTH_ENABLED: 'true',
          NODE_ENV: nodeEnv,
          CONNECTOR_MOCKS: mocks,
        }).CONNECTOR_MOCKS,
      ).toBe(mocks);
    }

    expect(() => validateConfig({ ...baseConfig, CONNECTOR_MOCKS: 'twilio_verify' })).toThrow(
      'CONNECTOR_MOCKS entries must be',
    );
  });

  describe('admin endpoint authentication', () => {
    it('is enabled when the flag is absent, so an unconfigured deployment cannot serve admin data unguarded', () => {
      const configWithoutFlag = { ...baseConfig, ...azureConfig };
      delete (configWithoutFlag as Partial<typeof configWithoutFlag>).ADMIN_AUTH_ENABLED;

      expect(validateConfig(configWithoutFlag).ADMIN_AUTH_ENABLED).toBe(true);
    });

    it('refuses to start without AZURE_TENANT_ID', () => {
      expect(() =>
        validateConfig({
          ...baseConfig,
          ...azureConfig,
          ADMIN_AUTH_ENABLED: 'true',
          AZURE_TENANT_ID: undefined,
        }),
      ).toThrow(/AZURE_TENANT_ID is required when ADMIN_AUTH_ENABLED=true/);
    });

    it('refuses to start without AZURE_API_AUDIENCE', () => {
      expect(() =>
        validateConfig({
          ...baseConfig,
          ...azureConfig,
          ADMIN_AUTH_ENABLED: 'true',
          AZURE_API_AUDIENCE: '   ',
        }),
      ).toThrow(/AZURE_API_AUDIENCE is required when ADMIN_AUTH_ENABLED=true/);
    });

    it.each(['common', 'organizations', 'consumers', 'COMMON'])(
      'rejects the multi-tenant placeholder %s, which would widen the accepted issuer',
      (tenantId) => {
        expect(() =>
          validateConfig({
            ...baseConfig,
            ...azureConfig,
            ADMIN_AUTH_ENABLED: 'true',
            AZURE_TENANT_ID: tenantId,
          }),
        ).toThrow(/concrete directory \(tenant\) id/);
      },
    );

    it('accepts and trims a concrete tenant and audience', () => {
      const config = validateConfig({
        ...baseConfig,
        ADMIN_AUTH_ENABLED: 'true',
        AZURE_TENANT_ID: `  ${azureConfig.AZURE_TENANT_ID}  `,
        AZURE_API_AUDIENCE: `  ${azureConfig.AZURE_API_AUDIENCE}  `,
      });

      expect(config.ADMIN_AUTH_ENABLED).toBe(true);
      expect(config.AZURE_TENANT_ID).toBe(azureConfig.AZURE_TENANT_ID);
      expect(config.AZURE_API_AUDIENCE).toBe(azureConfig.AZURE_API_AUDIENCE);
    });

    it('defaults the required app role to admin', () => {
      const config = validateConfig({ ...baseConfig, ...azureConfig, ADMIN_AUTH_ENABLED: 'true' });

      expect(config.ADMIN_REQUIRED_ROLES).toBe('admin');
    });

    it('normalizes a comma-separated role allowlist', () => {
      const config = validateConfig({
        ...baseConfig,
        ...azureConfig,
        ADMIN_AUTH_ENABLED: 'true',
        ADMIN_REQUIRED_ROLES: ' admin , auditor ,, ',
      });

      expect(config.ADMIN_REQUIRED_ROLES).toBe('admin,auditor');
    });

    it('refuses to start when the role allowlist is blank, which would lock everyone out', () => {
      expect(() =>
        validateConfig({
          ...baseConfig,
          ...azureConfig,
          ADMIN_AUTH_ENABLED: 'true',
          ADMIN_REQUIRED_ROLES: ' , ',
        }),
      ).toThrow(/ADMIN_REQUIRED_ROLES must name at least one Entra app role/);
    });

    describe('the SSO provider switch', () => {
      it('defaults to Entra, so an existing deployment keeps verifying what it always did', () => {
        const config = validateConfig({
          ...baseConfig,
          ...azureConfig,
          ADMIN_AUTH_ENABLED: 'true',
        });

        expect(config.ADMIN_SSO_PROVIDER).toBe('azure');
      });

      it('accepts a supported provider regardless of casing or padding', () => {
        const config = validateConfig({
          ...baseConfig,
          ...azureConfig,
          ADMIN_AUTH_ENABLED: 'true',
          ADMIN_SSO_PROVIDER: '  Azure  ',
        });

        expect(config.ADMIN_SSO_PROVIDER).toBe('azure');
      });

      it('refuses to start on an unsupported provider rather than silently verifying against Entra', () => {
        // Quietly falling back would accept tokens from a directory the operator believed they
        // had switched away from, which is the one failure this switch must not have.
        expect(() =>
          validateConfig({
            ...baseConfig,
            ...azureConfig,
            ADMIN_AUTH_ENABLED: 'true',
            ADMIN_SSO_PROVIDER: 'google',
          }),
        ).toThrow(/ADMIN_SSO_PROVIDER/);
      });

      it('rejects an unsupported provider even while admin auth is off', () => {
        // The escape hatch skips the provider's own settings, not the name of the provider: a
        // typo should be reported at the point it is written, not the day auth is switched on.
        expect(() => validateConfig({ ...baseConfig, ADMIN_SSO_PROVIDER: 'google' })).toThrow(
          /ADMIN_SSO_PROVIDER/,
        );
      });
    });

    it('does not require the Azure settings when the flag is off', () => {
      const config = validateConfig({ ...baseConfig, ADMIN_AUTH_ENABLED: 'false' });

      expect(config.ADMIN_AUTH_ENABLED).toBe(false);
      expect(config.AZURE_TENANT_ID).toBeUndefined();
    });

    describe('the escape hatch outside local development', () => {
      it('refuses to start when the flag is off in production', () => {
        // `.env.dist` ships the flag as false and sits on the engine's env search path, so a
        // deployment started with no explicit environment would otherwise serve admin data with
        // no credential demanded and only an audit row to show for it.
        expect(() =>
          validateConfig({ ...baseConfig, NODE_ENV: 'production', ADMIN_AUTH_ENABLED: 'false' }),
        ).toThrow(/ADMIN_AUTH_ENABLED=false is a local-only escape hatch/);
      });

      it.each(['development', 'test'])('still allows the flag to be off in %s', (nodeEnv) => {
        expect(
          validateConfig({ ...baseConfig, NODE_ENV: nodeEnv, ADMIN_AUTH_ENABLED: 'false' })
            .ADMIN_AUTH_ENABLED,
        ).toBe(false);
      });

      it('starts in production when the flag is on and the tenant is configured', () => {
        const config = validateConfig({
          ...baseConfig,
          ...azureConfig,
          NODE_ENV: 'production',
          ADMIN_AUTH_ENABLED: 'true',
        });

        expect(config.ADMIN_AUTH_ENABLED).toBe(true);
      });
    });
  });
});
