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
    AUDIT_ADMIN_API_KEY: 'audit-admin-key',
    AUDIT_NON_ADMIN_API_KEY: 'audit-non-admin-key',
  };

  it('rejects a missing WORKFLOWS_DIR value', () => {
    const configWithoutWorkflowsDir = { ...baseConfig };
    delete configWithoutWorkflowsDir.WORKFLOWS_DIR;

    expect(() => validateConfig(configWithoutWorkflowsDir)).toThrow(/WORKFLOWS_DIR/);
  });

  it('rejects a blank WORKFLOWS_DIR value', () => {
    expect(() => validateConfig({ ...baseConfig, WORKFLOWS_DIR: '   ' })).toThrow(/WORKFLOWS_DIR/);
  });

  it('accepts a non-empty WORKFLOWS_DIR value', () => {
    const config = validateConfig(baseConfig);

    expect(config).toBeInstanceOf(AppConfig);
    expect(config.WORKFLOWS_DIR).toBe('/tmp/workflows');
  });

  it('rejects missing audit credentials', () => {
    const configWithoutAuditKeys = { ...baseConfig };
    delete configWithoutAuditKeys.AUDIT_ADMIN_API_KEY;
    delete configWithoutAuditKeys.AUDIT_NON_ADMIN_API_KEY;

    expect(() => validateConfig(configWithoutAuditKeys)).toThrow(
      /AUDIT_ADMIN_API_KEY|AUDIT_NON_ADMIN_API_KEY/,
    );
  });

  it('rejects blank audit credentials', () => {
    expect(() => validateConfig({ ...baseConfig, AUDIT_ADMIN_API_KEY: '   ' })).toThrow(
      /AUDIT_ADMIN_API_KEY/,
    );
    expect(() => validateConfig({ ...baseConfig, AUDIT_NON_ADMIN_API_KEY: '   ' })).toThrow(
      /AUDIT_NON_ADMIN_API_KEY/,
    );
  });

  it('rejects equal audit credentials', () => {
    expect(() =>
      validateConfig({ ...baseConfig, AUDIT_NON_ADMIN_API_KEY: baseConfig.AUDIT_ADMIN_API_KEY }),
    ).toThrow(/distinct/);
  });

  it('accepts distinct non-empty audit credentials', () => {
    const config = validateConfig(baseConfig);

    expect(config.AUDIT_ADMIN_API_KEY).toBe('audit-admin-key');
    expect(config.AUDIT_NON_ADMIN_API_KEY).toBe('audit-non-admin-key');
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
});
