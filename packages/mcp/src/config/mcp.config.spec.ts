import 'reflect-metadata';
import { NodeEnv, validateConfig } from './mcp.config';

describe('validateConfig', () => {
  const baseConfig = {
    NODE_ENV: 'development',
    MCP_PUBLIC_URL: 'http://localhost:3100',
    MCP_ENGINE_BASE_URL: 'http://engine:3000',
    MCP_MASKING_KEY: 'k'.repeat(32),
    MCP_AUTH_ENABLED: 'false',
  };

  const azureConfig = {
    MCP_AUTH_ENABLED: 'true',
    MCP_AZURE_TENANT_ID: '11111111-1111-1111-1111-111111111111',
    MCP_AZURE_CLIENT_ID: '22222222-2222-2222-2222-222222222222',
    MCP_AZURE_CLIENT_SECRET: 'secret',
    MCP_ENGINE_SCOPE: 'api://engine/.default',
  };

  it('applies the documented defaults', () => {
    const config = validateConfig(baseConfig);

    expect(config.MCP_PORT).toBe(3100);
    expect(config.MCP_REQUIRED_SCOPE).toBe('Mcp.Access');
    expect(config.MCP_MASKING_PASS_FIELDS).toBe('country,nationality');
    expect(config.MCP_WRITE_TOOLS_ENABLED).toBe(false);
  });

  it('leaves MCP_PUBLIC_CLIENT_ID unset by default and when blank, and keeps a value', () => {
    expect(validateConfig(baseConfig).MCP_PUBLIC_CLIENT_ID).toBeUndefined();
    expect(
      validateConfig({ ...baseConfig, MCP_PUBLIC_CLIENT_ID: '  ' }).MCP_PUBLIC_CLIENT_ID,
    ).toBeUndefined();
    expect(
      validateConfig({ ...baseConfig, MCP_PUBLIC_CLIENT_ID: ' public-client ' })
        .MCP_PUBLIC_CLIENT_ID,
    ).toBe('public-client');
  });

  it('parses the port, the write-tools flag and the pass fields', () => {
    const config = validateConfig({
      ...baseConfig,
      MCP_PORT: '4100',
      MCP_WRITE_TOOLS_ENABLED: 'true',
      MCP_MASKING_PASS_FIELDS: ' country ',
    });

    expect(config.MCP_PORT).toBe(4100);
    expect(config.MCP_WRITE_TOOLS_ENABLED).toBe(true);
    expect(config.MCP_MASKING_PASS_FIELDS).toBe('country');
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => validateConfig({ ...baseConfig, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects a missing MCP_PUBLIC_URL or MCP_ENGINE_BASE_URL', () => {
    expect(() => validateConfig({ ...baseConfig, MCP_PUBLIC_URL: undefined })).toThrow(
      /MCP_PUBLIC_URL/,
    );
    expect(() => validateConfig({ ...baseConfig, MCP_ENGINE_BASE_URL: undefined })).toThrow(
      /MCP_ENGINE_BASE_URL/,
    );
  });

  describe('MCP_MASKING_KEY', () => {
    it('fails when missing', () => {
      expect(() => validateConfig({ ...baseConfig, MCP_MASKING_KEY: undefined })).toThrow(
        /MCP_MASKING_KEY/,
      );
    });

    it('fails when shorter than 32 bytes', () => {
      expect(() => validateConfig({ ...baseConfig, MCP_MASKING_KEY: 'k'.repeat(31) })).toThrow(
        /MCP_MASKING_KEY must be at least 32 bytes/,
      );
    });
  });

  describe('MCP_AUTH_ENABLED', () => {
    it('fails with NODE_ENV=production when false', () => {
      expect(() =>
        validateConfig({ ...baseConfig, NODE_ENV: NodeEnv.PRODUCTION, MCP_AUTH_ENABLED: 'false' }),
      ).toThrow(/MCP_AUTH_ENABLED=false/);
    });

    it('accepts false outside production', () => {
      expect(validateConfig(baseConfig).MCP_AUTH_ENABLED).toBe(false);
    });

    it('defaults to enabled, which demands the Entra settings', () => {
      const environment: Record<string, unknown> = { ...baseConfig };
      delete environment.MCP_AUTH_ENABLED;

      expect(() => validateConfig(environment)).toThrow(/MCP_AZURE_TENANT_ID/);
    });

    it.each([
      'MCP_AZURE_TENANT_ID',
      'MCP_AZURE_CLIENT_ID',
      'MCP_AZURE_CLIENT_SECRET',
      'MCP_ENGINE_SCOPE',
    ])('fails when enabled without %s', (variable) => {
      expect(() =>
        validateConfig({ ...baseConfig, ...azureConfig, [variable]: undefined }),
      ).toThrow(new RegExp(variable));
    });

    it('accepts production with auth enabled, every Entra setting and an https public URL', () => {
      const config = validateConfig({
        ...baseConfig,
        ...azureConfig,
        NODE_ENV: NodeEnv.PRODUCTION,
        MCP_PUBLIC_URL: 'https://mcp.example.com',
      });

      expect(config.MCP_AUTH_ENABLED).toBe(true);
    });

    it('refuses an http public URL in production, where it is the sign-in issuer', () => {
      expect(() =>
        validateConfig({
          ...baseConfig,
          ...azureConfig,
          NODE_ENV: NodeEnv.PRODUCTION,
          MCP_PUBLIC_URL: 'http://mcp.example.com',
        }),
      ).toThrow(/MCP_PUBLIC_URL must use https/);
    });

    it('accepts an http public URL outside production', () => {
      expect(validateConfig({ ...baseConfig, ...azureConfig }).MCP_PUBLIC_URL).toMatch(/^http:/);
    });
  });
});
