import { ConfigService } from '@nestjs/config';
import { readAuthorizationServerSettings } from './authorization-server.settings';

const AZURE_CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const PUBLIC_CLIENT_ID = '22222222-2222-2222-2222-222222222222';

function buildConfig(publicClientId?: string): ConfigService {
  return new ConfigService({
    MCP_PUBLIC_URL: 'http://localhost:3100',
    MCP_AZURE_TENANT_ID: '33333333-3333-3333-3333-333333333333',
    MCP_AZURE_CLIENT_ID: AZURE_CLIENT_ID,
    MCP_REQUIRED_SCOPE: 'Mcp.Access',
    ...(publicClientId === undefined ? {} : { MCP_PUBLIC_CLIENT_ID: publicClientId }),
  });
}

describe('readAuthorizationServerSettings', () => {
  it('hands out MCP_PUBLIC_CLIENT_ID when it is set', () => {
    expect(readAuthorizationServerSettings(buildConfig(PUBLIC_CLIENT_ID)).publicClientId).toBe(
      PUBLIC_CLIENT_ID,
    );
  });

  it('falls back to MCP_AZURE_CLIENT_ID when MCP_PUBLIC_CLIENT_ID is unset', () => {
    expect(readAuthorizationServerSettings(buildConfig()).publicClientId).toBe(AZURE_CLIENT_ID);
  });

  it('falls back to MCP_AZURE_CLIENT_ID when Compose passes MCP_PUBLIC_CLIENT_ID as blank', () => {
    expect(readAuthorizationServerSettings(buildConfig('')).publicClientId).toBe(AZURE_CLIENT_ID);
    expect(readAuthorizationServerSettings(buildConfig('  ')).publicClientId).toBe(AZURE_CLIENT_ID);
  });
});
