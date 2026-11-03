import { ConfigService } from '@nestjs/config';
import {
  buildAuthorizationServerMetadata,
  type AuthorizationServerMetadata,
} from './authorization-server-metadata';
import { readAuthorizationServerSettings } from './authorization-server.settings';
import { AuthorizeRewriter } from './authorize-rewriter';
import { ClientRegistrar } from './client-registrar';
import { TokenRelay } from './token-relay';

export const AUTHORIZATION_SERVER_RELAY = Symbol('AUTHORIZATION_SERVER_RELAY');

/** What the relay's routes serve with: Entra stays the only issuer behind all four. */
export interface AuthorizationServerRelay {
  metadata: AuthorizationServerMetadata;
  authorize: AuthorizeRewriter;
  token: TokenRelay;
  registrar: ClientRegistrar;
}

/** `null` when `MCP_AUTH_ENABLED=false`: with no sign-in there is nothing to relay. */
export function createAuthorizationServerRelay(
  config: ConfigService,
): AuthorizationServerRelay | null {
  if (!config.getOrThrow<boolean>('MCP_AUTH_ENABLED')) {
    return null;
  }

  const settings = readAuthorizationServerSettings(config);

  return {
    metadata: buildAuthorizationServerMetadata(settings),
    authorize: new AuthorizeRewriter(settings),
    token: new TokenRelay(settings),
    registrar: new ClientRegistrar(settings.publicClientId),
  };
}
