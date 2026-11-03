import { ConfigService } from '@nestjs/config';
import { buildEntraAuthority } from '../entra';
import { getPublicUrl, getResourceScope } from '../protected-resource';

export const AUTHORIZE_PATH = 'oauth/authorize';
export const TOKEN_PATH = 'oauth/token';
export const REGISTER_PATH = 'oauth/register';

export interface AuthorizationServerSettings {
  /** `MCP_PUBLIC_URL` without a trailing slash: the issuer this server presents. */
  publicUrl: string;
  tenantId: string;
  /** The only client id the relay accepts and hands out. */
  publicClientId: string;
  /** The scope of this server's own app registration, `api://<client>/<scope>`. */
  resourceScope: string;
}

export function readAuthorizationServerSettings(
  config: ConfigService,
): AuthorizationServerSettings {
  return {
    publicUrl: getPublicUrl(config),
    tenantId: config.getOrThrow<string>('MCP_AZURE_TENANT_ID'),
    // `||`, not `??`: Compose passes an unset variable as an empty string, and `ConfigService.get`
    // falls back to that raw `process.env` value when validation dropped the blank.
    publicClientId:
      config.get<string>('MCP_PUBLIC_CLIENT_ID')?.trim() ||
      config.getOrThrow<string>('MCP_AZURE_CLIENT_ID'),
    resourceScope: getResourceScope(config),
  };
}

/** The tenant's authorization endpoint: the one place the relay ever sends a browser. */
export function buildEntraAuthorizeUrl(tenantId: string): string {
  return `${buildEntraAuthority(tenantId)}/oauth2/v2.0/authorize`;
}

/** The tenant's token endpoint: the one place the relay ever sends a request. */
export function buildEntraTokenUrl(tenantId: string): string {
  return `${buildEntraAuthority(tenantId)}/oauth2/v2.0/token`;
}
