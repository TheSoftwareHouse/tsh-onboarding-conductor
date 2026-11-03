import { ConfigService } from '@nestjs/config';

const MCP_PATH = '/mcp';
const METADATA_PATH = '/.well-known/oauth-protected-resource';

/**
 * RFC 9728 protected-resource metadata: what a client needs to start sign-in. The authorization
 * server it names is this server, which relays to Entra (`authorization-server/`).
 */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
}

/** `MCP_PUBLIC_URL` without a trailing slash: the origin clients know this server by. */
export function getPublicUrl(config: ConfigService): string {
  return config.getOrThrow<string>('MCP_PUBLIC_URL').replace(/\/+$/, '');
}

/** Where a client finds the metadata of the `/mcp` resource (RFC 9728 §3.1: path suffixed). */
export function getMetadataUrl(config: ConfigService): string {
  return `${getPublicUrl(config)}${METADATA_PATH}${MCP_PATH}`;
}

/** The delegated scope a client requests: this server's app registration plus its scope name. */
export function getResourceScope(config: ConfigService): string {
  const clientId = config.getOrThrow<string>('MCP_AZURE_CLIENT_ID');

  return `api://${clientId}/${config.getOrThrow<string>('MCP_REQUIRED_SCOPE')}`;
}

export function getProtectedResourceMetadata(config: ConfigService): ProtectedResourceMetadata {
  return {
    resource: `${getPublicUrl(config)}${MCP_PATH}`,
    authorization_servers: [getPublicUrl(config)],
    scopes_supported: [getResourceScope(config)],
  };
}
