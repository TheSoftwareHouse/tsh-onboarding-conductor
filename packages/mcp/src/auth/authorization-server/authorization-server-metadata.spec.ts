import { buildAuthorizationServerMetadata } from './authorization-server-metadata';

describe('buildAuthorizationServerMetadata', () => {
  it('names this server as issuer and every endpoint under it', () => {
    expect(
      buildAuthorizationServerMetadata({
        publicUrl: 'https://mcp.example.com',
        tenantId: 'tenant-id',
        publicClientId: 'public-client',
        resourceScope: 'api://client-id/Mcp.Access',
      }),
    ).toEqual({
      issuer: 'https://mcp.example.com',
      authorization_endpoint: 'https://mcp.example.com/oauth/authorize',
      token_endpoint: 'https://mcp.example.com/oauth/token',
      registration_endpoint: 'https://mcp.example.com/oauth/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['api://client-id/Mcp.Access', 'offline_access'],
    });
  });
});
