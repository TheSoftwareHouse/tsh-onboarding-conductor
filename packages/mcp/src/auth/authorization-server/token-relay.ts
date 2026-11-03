import { HttpStatus } from '@nestjs/common';
import { MILLISECONDS_PER_SECOND } from '../../time.constants';
import {
  buildEntraTokenUrl,
  type AuthorizationServerSettings,
} from './authorization-server.settings';
import { OAuthRequestError } from './oauth-error';
import {
  GRANT_TYPE_REFRESH_TOKEN,
  pickStringFields,
  SUPPORTED_GRANT_TYPES,
  withOfflineAccess,
} from './oauth-fields';

/** The most a token request body may be: an authorization code and a PKCE verifier are far smaller. */
const BYTES_PER_KIBIBYTE = 1024;
const TOKEN_BODY_LIMIT_KIBIBYTES = 16;
export const TOKEN_BODY_LIMIT_BYTES = TOKEN_BODY_LIMIT_KIBIBYTES * BYTES_PER_KIBIBYTE;

export const TOKEN_REQUEST_TIMEOUT_MS = 10 * MILLISECONDS_PER_SECOND;

/** The grant fields forwarded to Entra; `resource` is deliberately not among them. */
const GRANT_FIELDS = [
  'grant_type',
  'code',
  'redirect_uri',
  'code_verifier',
  'refresh_token',
  'client_id',
  'scope',
] as const;

/** What Entra answered, to be handed to the client as it came. */
export interface TokenRelayResponse {
  status: number;
  body: unknown;
}

/**
 * Redeems a client's authorization code or refresh token at the tenant's token endpoint. Only
 * {@link GRANT_FIELDS} are forwarded; Entra's status and JSON body come back unchanged. Nothing it
 * sees — a code, a verifier, a token — is logged or kept.
 */
export class TokenRelay {
  constructor(private readonly settings: AuthorizationServerSettings) {}

  async relay(body: unknown): Promise<TokenRelayResponse> {
    const fields = pickStringFields(body, GRANT_FIELDS);
    const grantType = fields.get('grant_type');

    if (!grantType || !SUPPORTED_GRANT_TYPES.includes(grantType)) {
      throw new OAuthRequestError('unsupported_grant_type', 'Unsupported grant_type');
    }
    if (fields.get('client_id') !== this.settings.publicClientId) {
      throw new OAuthRequestError('invalid_client', 'Unknown client_id');
    }
    if (grantType === GRANT_TYPE_REFRESH_TOKEN) {
      // The SDK client sends no scope on refresh, and a refresh must keep asking for a refresh token.
      fields.set('scope', withOfflineAccess(this.settings.resourceScope));
    }

    try {
      const response = await fetch(buildEntraTokenUrl(this.settings.tenantId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams([...fields]).toString(),
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      });

      return { status: response.status, body: await response.json() };
    } catch {
      // The cause (a timeout, a refused connection, a non-JSON answer) says nothing the client can act on.
      throw new OAuthRequestError(
        'temporarily_unavailable',
        'The sign-in service could not be reached',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
