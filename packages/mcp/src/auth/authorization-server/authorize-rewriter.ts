import {
  buildEntraAuthorizeUrl,
  type AuthorizationServerSettings,
} from './authorization-server.settings';
import { OAuthRequestError } from './oauth-error';
import {
  CODE_CHALLENGE_METHOD_S256,
  pickStringFields,
  RESPONSE_TYPE_CODE,
  withOfflineAccess,
} from './oauth-fields';

/** What Entra's authorization endpoint is sent; `resource` is deliberately not among them. */
const AUTHORIZE_FIELDS = [
  'client_id',
  'response_type',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
  'prompt',
  'login_hint',
  'nonce',
] as const;

/**
 * Turns a client's authorization request into the one Entra accepts. Entra v2 rejects the RFC 8707
 * `resource` parameter next to a scope that names a resource, so only {@link AUTHORIZE_FIELDS}
 * pass, and `offline_access` is added so a refresh token is issued. The target host is fixed: no
 * request value chooses where the browser is sent.
 */
export class AuthorizeRewriter {
  constructor(private readonly settings: AuthorizationServerSettings) {}

  /** The Entra URL to redirect the browser to, or an {@link OAuthRequestError} when refused. */
  buildRedirectUrl(query: unknown): string {
    const fields = pickStringFields(query, AUTHORIZE_FIELDS);

    if (fields.get('client_id') !== this.settings.publicClientId) {
      throw new OAuthRequestError('invalid_client', 'Unknown client_id');
    }
    if (fields.get('response_type') !== RESPONSE_TYPE_CODE) {
      throw new OAuthRequestError(
        'unsupported_response_type',
        'Only response_type=code is supported',
      );
    }
    if (fields.get('code_challenge_method') !== CODE_CHALLENGE_METHOD_S256) {
      throw new OAuthRequestError(
        'invalid_request',
        'PKCE with code_challenge_method=S256 is required',
      );
    }

    // A client that sends no scope would get a token without this server's audience; ask for it.
    fields.set('scope', withOfflineAccess(fields.get('scope') || this.settings.resourceScope));

    const url = new URL(buildEntraAuthorizeUrl(this.settings.tenantId));
    for (const [name, value] of fields) {
      url.searchParams.set(name, value);
    }

    return url.toString();
  }
}
