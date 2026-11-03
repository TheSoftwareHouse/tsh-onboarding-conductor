import { MILLISECONDS_PER_SECOND } from '../../time.constants';
import { LOOPBACK_HOSTNAMES } from '../../transport/dns-rebinding';
import { OAuthRequestError } from './oauth-error';
import {
  SUPPORTED_GRANT_TYPES,
  SUPPORTED_RESPONSE_TYPES,
  TOKEN_ENDPOINT_AUTH_METHOD_NONE,
} from './oauth-fields';

/** RFC 7591 §3.2.1 client information response, as far as a stateless public client needs. */
export interface ClientRegistration {
  client_id: string;
  client_id_issued_at: number;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
}

/**
 * The stateless stand-in for dynamic client registration, which Entra lacks: every registration is
 * answered with the one configured public client id and nothing is stored. A native client's
 * redirect URI is loopback by definition (RFC 8252), so nothing else is accepted.
 */
export class ClientRegistrar {
  constructor(
    private readonly publicClientId: string,
    private readonly now: () => number = Date.now,
  ) {}

  register(metadata: unknown): ClientRegistration {
    if (typeof metadata !== 'object' || metadata === null) {
      throw new OAuthRequestError(
        'invalid_client_metadata',
        'Client metadata must be a JSON object',
      );
    }

    const redirectUris = readStrings((metadata as Record<string, unknown>).redirect_uris);

    if (!redirectUris?.length || !redirectUris.every(isLoopbackRedirectUri)) {
      throw new OAuthRequestError(
        'invalid_redirect_uri',
        'redirect_uris must be http://localhost or http://127.0.0.1 URLs',
      );
    }

    this.assertSupported(metadata, 'grant_types', SUPPORTED_GRANT_TYPES);
    this.assertSupported(metadata, 'response_types', SUPPORTED_RESPONSE_TYPES);
    this.assertSupported(metadata, 'token_endpoint_auth_method', [TOKEN_ENDPOINT_AUTH_METHOD_NONE]);

    return {
      client_id: this.publicClientId,
      client_id_issued_at: Math.floor(this.now() / MILLISECONDS_PER_SECOND),
      redirect_uris: redirectUris,
      grant_types: SUPPORTED_GRANT_TYPES,
      response_types: SUPPORTED_RESPONSE_TYPES,
      token_endpoint_auth_method: TOKEN_ENDPOINT_AUTH_METHOD_NONE,
    };
  }

  /** A field a client states must be something the relay can do; one it leaves out is defaulted. */
  private assertSupported(metadata: object, name: string, supported: readonly string[]): void {
    const value = (metadata as Record<string, unknown>)[name];

    if (value === undefined) {
      return;
    }

    const requested = typeof value === 'string' ? [value] : readStrings(value);

    if (!requested || !requested.every((entry) => supported.includes(entry))) {
      throw new OAuthRequestError('invalid_client_metadata', `Unsupported ${name}`);
    }
  }
}

function readStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? (value as string[])
    : undefined;
}

function isLoopbackRedirectUri(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value);

    return protocol === 'http:' && LOOPBACK_HOSTNAMES.includes(hostname);
  } catch {
    return false;
  }
}
