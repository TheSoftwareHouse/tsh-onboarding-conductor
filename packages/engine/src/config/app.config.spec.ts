import 'reflect-metadata';
import { AppConfig, validateConfig } from './app.config';

describe('validateConfig', () => {
  const baseConfig = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    STORAGE_S3_ACCESS_KEY_ID: 'access-key',
    STORAGE_S3_SECRET_ACCESS_KEY: 'secret-key',
  };

  it('rejects a missing WORKFLOWS_DIR value', () => {
    expect(() => validateConfig(baseConfig)).toThrow(/WORKFLOWS_DIR/);
  });

  it('rejects a blank WORKFLOWS_DIR value', () => {
    expect(() => validateConfig({ ...baseConfig, WORKFLOWS_DIR: '   ' })).toThrow(/WORKFLOWS_DIR/);
  });

  it('accepts a non-empty WORKFLOWS_DIR value', () => {
    const config = validateConfig({ ...baseConfig, WORKFLOWS_DIR: '/tmp/workflows' });

    expect(config).toBeInstanceOf(AppConfig);
    expect(config.WORKFLOWS_DIR).toBe('/tmp/workflows');
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
});
