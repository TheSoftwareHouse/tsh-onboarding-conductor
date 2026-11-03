import {
  CODE_CHALLENGE_METHOD_S256,
  OFFLINE_ACCESS_SCOPE,
  SUPPORTED_GRANT_TYPES,
  SUPPORTED_RESPONSE_TYPES,
  TOKEN_ENDPOINT_AUTH_METHOD_NONE,
} from './oauth-fields';
import {
  AUTHORIZE_PATH,
  REGISTER_PATH,
  TOKEN_PATH,
  type AuthorizationServerSettings,
} from './authorization-server.settings';

/** RFC 8414 authorization-server metadata, as far as the relay's four routes support. */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  scopes_supported: string[];
}

export function buildAuthorizationServerMetadata({
  publicUrl,
  resourceScope,
}: AuthorizationServerSettings): AuthorizationServerMetadata {
  return {
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}/${AUTHORIZE_PATH}`,
    token_endpoint: `${publicUrl}/${TOKEN_PATH}`,
    registration_endpoint: `${publicUrl}/${REGISTER_PATH}`,
    response_types_supported: SUPPORTED_RESPONSE_TYPES,
    grant_types_supported: SUPPORTED_GRANT_TYPES,
    code_challenge_methods_supported: [CODE_CHALLENGE_METHOD_S256],
    token_endpoint_auth_methods_supported: [TOKEN_ENDPOINT_AUTH_METHOD_NONE],
    scopes_supported: [resourceScope, OFFLINE_ACCESS_SCOPE],
  };
}
