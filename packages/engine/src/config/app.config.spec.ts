import 'reflect-metadata';
import { AppConfig, validateConfig } from './app.config';
import { NodeEnv } from './environment.config';

describe('validateConfig', () => {
  const baseConfig = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    ADMIN_PANEL_ORIGIN: 'http://localhost:5173',
    NODE_ENV: 'development',
    ENVIRONMENT_NAME: 'dev',
    STORAGE_S3_ACCESS_KEY_ID: 'access-key',
    STORAGE_S3_SECRET_ACCESS_KEY: 'secret-key',
    // Off for the cases below, which are about other settings. The admin-auth rules have their
    // own block at the end of this file and set the flag themselves.
    ADMIN_AUTH_ENABLED: 'false',
  };

  const betterAuthConfig = {
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:3000',
    AUTH_SMTP_URL: 'smtp://mailhog:1025',
    AUTH_MAIL_FROM: 'no-reply@example.test',
  };

  const microsoftConfig = {
    AUTH_MICROSOFT_CLIENT_ID: '33333333-3333-3333-3333-333333333333',
    AUTH_MICROSOFT_CLIENT_SECRET: 'microsoft-client-secret',
    AUTH_MICROSOFT_TENANT_ID: '11111111-1111-1111-1111-111111111111',
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

  it('rejects a OTP_SMS_TIMEOUT_MS value outside the allowed bounds', () => {
    expect(() => validateConfig({ ...baseConfig, OTP_SMS_TIMEOUT_MS: 99 })).toThrow(
      /OTP_SMS_TIMEOUT_MS/,
    );
  });

  it('defaults the OTP SMS timeout', () => {
    const config = validateConfig(baseConfig);

    expect(config.OTP_SMS_TIMEOUT_MS).toBe(10000);
  });

  it('defaults the OTP database pool size', () => {
    expect(validateConfig(baseConfig).OTP_DATABASE_POOL_SIZE).toBe(5);
  });

  it('rejects an OTP_DATABASE_POOL_SIZE outside the allowed bounds', () => {
    expect(() => validateConfig({ ...baseConfig, OTP_DATABASE_POOL_SIZE: 0 })).toThrow(
      /OTP_DATABASE_POOL_SIZE/,
    );
    expect(() => validateConfig({ ...baseConfig, OTP_DATABASE_POOL_SIZE: 51 })).toThrow(
      /OTP_DATABASE_POOL_SIZE/,
    );
  });

  it('defaults the http connector timeout', () => {
    const config = validateConfig(baseConfig);

    expect(config.HTTP_CONNECTOR_TIMEOUT_MS).toBe(5000);
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

  it('defaults HTTP_CONNECTOR_SECRETS to an empty object', () => {
    expect(validateConfig(baseConfig).HTTP_CONNECTOR_SECRETS).toBe('{}');
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

  it('applies default encryption sweep settings', () => {
    const config = validateConfig(baseConfig);

    expect(config.ENCRYPTION_SWEEP_POLL_INTERVAL_MS).toBe(5000);
    expect(config.ENCRYPTION_SWEEP_BATCH_SIZE).toBe(100);
  });

  it('accepts valid encryption sweep settings', () => {
    const config = validateConfig({
      ...baseConfig,
      ENCRYPTION_SWEEP_POLL_INTERVAL_MS: 1000,
      ENCRYPTION_SWEEP_BATCH_SIZE: 50,
    });

    expect(config.ENCRYPTION_SWEEP_POLL_INTERVAL_MS).toBe(1000);
    expect(config.ENCRYPTION_SWEEP_BATCH_SIZE).toBe(50);
  });

  it('rejects a sweep poll interval below the minimum', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        ENCRYPTION_SWEEP_POLL_INTERVAL_MS: 100,
      }),
    ).toThrow(/ENCRYPTION_SWEEP_POLL_INTERVAL_MS/);
  });

  it('rejects a sweep batch size below the minimum', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        ENCRYPTION_SWEEP_BATCH_SIZE: 0,
      }),
    ).toThrow(/ENCRYPTION_SWEEP_BATCH_SIZE/);
  });

  it('rejects a sweep batch size above the maximum', () => {
    expect(() =>
      validateConfig({
        ...baseConfig,
        ENCRYPTION_SWEEP_BATCH_SIZE: 1001,
      }),
    ).toThrow(/ENCRYPTION_SWEEP_BATCH_SIZE/);
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
    const mocks = 'otp:mock_otp';

    // Configuring the pairs is allowed anywhere; only a test run applies them, which the
    // connector registry decides rather than this validation.
    for (const nodeEnv of ['test', 'development', 'production']) {
      expect(
        validateConfig({
          ...baseConfig,
          ...betterAuthConfig,
          // Production refuses to start with the admin-auth escape hatch open, which is a rule
          // of its own; this case is only about the mock pairs.
          ADMIN_AUTH_ENABLED: 'true',
          NODE_ENV: nodeEnv,
          CONNECTOR_MOCKS: mocks,
        }).CONNECTOR_MOCKS,
      ).toBe(mocks);
    }

    expect(() => validateConfig({ ...baseConfig, CONNECTOR_MOCKS: 'otp' })).toThrow(
      'CONNECTOR_MOCKS entries must be',
    );
  });

  describe('data encryption', () => {
    it('requires no key-encryption key by default', () => {
      const config = validateConfig(baseConfig);

      expect(config.ENCRYPTION_KEY).toBeUndefined();
    });

    it('treats an empty key-encryption key as absent, as docker-compose forwards it', () => {
      const config = validateConfig({ ...baseConfig, ENCRYPTION_KEY: '' });

      expect(config.ENCRYPTION_KEY).toBe('');
    });

    it('refuses to start with a malformed key-encryption key', () => {
      expect(() => validateConfig({ ...baseConfig, ENCRYPTION_KEY: 'not-valid-base64!!' })).toThrow(
        'ENCRYPTION_KEY must be valid base64',
      );
    });

    it('refuses to start with a wrong-length key-encryption key', () => {
      const shortKey = Buffer.alloc(16, 1).toString('base64');

      expect(() => validateConfig({ ...baseConfig, ENCRYPTION_KEY: shortKey })).toThrow(
        'ENCRYPTION_KEY must decode to exactly 32 bytes (got 16)',
      );
    });

    it('accepts a valid key-encryption key', () => {
      const key = Buffer.alloc(32, 1).toString('base64');

      const config = validateConfig({ ...baseConfig, ENCRYPTION_KEY: key });

      expect(config.ENCRYPTION_KEY).toBe(key);
    });
  });

  describe('admin endpoint authentication', () => {
    it('is enabled when the flag is absent, so an unconfigured deployment cannot serve admin data unguarded', () => {
      const configWithoutFlag = { ...baseConfig, ...betterAuthConfig };
      delete (configWithoutFlag as Partial<typeof configWithoutFlag>).ADMIN_AUTH_ENABLED;

      expect(validateConfig(configWithoutFlag).ADMIN_AUTH_ENABLED).toBe(true);
    });

    describe('better-auth settings', () => {
      const authOn = {
        ...baseConfig,
        ...betterAuthConfig,
        ADMIN_AUTH_ENABLED: 'true',
      };

      it('accepts a complete configuration', () => {
        expect(validateConfig(authOn).BETTER_AUTH_URL).toBe('http://localhost:3000');
      });

      it.each(['BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'AUTH_SMTP_URL', 'AUTH_MAIL_FROM'])(
        'refuses to start without %s',
        (name) => {
          expect(() => validateConfig({ ...authOn, [name]: undefined })).toThrow(
            new RegExp(`${name} is required when ADMIN_AUTH_ENABLED=true`),
          );
          expect(() => validateConfig({ ...authOn, [name]: '   ' })).toThrow(
            new RegExp(`${name} is required`),
          );
        },
      );

      it('refuses a BETTER_AUTH_SECRET shorter than 32 characters', () => {
        expect(() => validateConfig({ ...authOn, BETTER_AUTH_SECRET: 'x'.repeat(31) })).toThrow(
          /BETTER_AUTH_SECRET must be at least 32 characters/,
        );
      });

      it.each(['not a url', 'ftp://engine.example.com', 'localhost:3000'])(
        'refuses BETTER_AUTH_URL %s that is not an absolute http(s) URL',
        (url) => {
          expect(() => validateConfig({ ...authOn, BETTER_AUTH_URL: url })).toThrow(
            /BETTER_AUTH_URL must be an absolute http\(s\) URL/,
          );
        },
      );

      it('does not require the settings while admin auth is off', () => {
        expect(() => validateConfig(baseConfig)).not.toThrow();
      });

      it.each([
        ['AUTH_SUPERADMIN_EMAIL', 'AUTH_SUPERADMIN_PASSWORD'],
        ['AUTH_SUPERADMIN_PASSWORD', 'AUTH_SUPERADMIN_EMAIL'],
      ])('refuses %s without %s', (present) => {
        expect(() => validateConfig({ ...authOn, [present]: 'value-1234567' })).toThrow(
          /AUTH_SUPERADMIN_EMAIL and AUTH_SUPERADMIN_PASSWORD must be set together/,
        );
      });

      it('accepts the superadmin pair and treats blank values as unset', () => {
        expect(() =>
          validateConfig({
            ...authOn,
            AUTH_SUPERADMIN_EMAIL: 'root@example.test',
            AUTH_SUPERADMIN_PASSWORD: 'a-long-password',
          }),
        ).not.toThrow();
        expect(() =>
          validateConfig({ ...authOn, AUTH_SUPERADMIN_EMAIL: '', AUTH_SUPERADMIN_PASSWORD: '' }),
        ).not.toThrow();
      });

      it.each(Object.keys(microsoftConfig))('refuses a Microsoft triple missing %s', (name) => {
        expect(() => validateConfig({ ...authOn, ...microsoftConfig, [name]: undefined })).toThrow(
          /must be set together/,
        );
      });

      it.each(['common', 'organizations', 'consumers', 'not-a-guid'])(
        'refuses the Microsoft tenant %s, which is not a concrete GUID',
        (tenant) => {
          expect(() =>
            validateConfig({ ...authOn, ...microsoftConfig, AUTH_MICROSOFT_TENANT_ID: tenant }),
          ).toThrow(/AUTH_MICROSOFT_TENANT_ID must be a concrete tenant GUID/);
        },
      );

      it('accepts a complete Microsoft triple', () => {
        expect(validateConfig({ ...authOn, ...microsoftConfig }).AUTH_MICROSOFT_TENANT_ID).toBe(
          microsoftConfig.AUTH_MICROSOFT_TENANT_ID,
        );
      });
    });

    describe('the escape hatch outside local development', () => {
      it('refuses to start when the flag is off in production', () => {
        // `.env.dist` ships the flag as false, so a production `.env` copied from it would otherwise
        // serve admin data with no credential demanded and only an audit row to show for it.
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

      it('starts in production when the flag is on and better-auth is configured', () => {
        const config = validateConfig({
          ...baseConfig,
          ...betterAuthConfig,
          NODE_ENV: 'production',
          ADMIN_AUTH_ENABLED: 'true',
        });

        expect(config.ADMIN_AUTH_ENABLED).toBe(true);
      });
    });
  });
  describe('environment', () => {
    it.each(['dev', 'staging', 'pre-prod', 'prod'])('accepts %s as a name', (name) => {
      expect(validateConfig({ ...baseConfig, ENVIRONMENT_NAME: name }).ENVIRONMENT_NAME).toBe(name);
    });

    it('trims the name', () => {
      expect(
        validateConfig({ ...baseConfig, ENVIRONMENT_NAME: '  staging ' }).ENVIRONMENT_NAME,
      ).toBe('staging');
    });

    it.each([undefined, '', 'Pre Prod', '-prod', 'prod_eu'])('refuses %p as a name', (name) => {
      expect(() => validateConfig({ ...baseConfig, ENVIRONMENT_NAME: name })).toThrow(
        /ENVIRONMENT_NAME/,
      );
    });

    it.each([undefined, '', 'staging', 'Production'])('refuses %p as NODE_ENV', (nodeEnv) => {
      expect(() => validateConfig({ ...baseConfig, NODE_ENV: nodeEnv })).toThrow(/NODE_ENV/);
    });

    it('lets any name run in production', () => {
      const config = validateConfig({
        ...baseConfig,
        ...betterAuthConfig,
        ADMIN_AUTH_ENABLED: 'true',
        ENVIRONMENT_NAME: 'pre-prod',
        NODE_ENV: NodeEnv.PRODUCTION,
      });

      expect(config.ENVIRONMENT_NAME).toBe('pre-prod');
      expect(config.NODE_ENV).toBe(NodeEnv.PRODUCTION);
    });
  });
});
