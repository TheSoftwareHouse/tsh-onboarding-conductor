import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import {
  AdminTokenVerificationError,
  AdminTokenVerifierUnavailableError,
  type AdminTokenVerifierPort,
} from './admin-token-verifier.port';

export const ENTRA_AUTHORITY_HOST = 'https://login.microsoftonline.com';

/**
 * `jose` failures that mean the key set could not be fetched or understood, rather than that the
 * token was bad. The generic code is what a non-200 or unparseable JWKS response raises; every
 * token-level failure carries a specific subclass code, so it is unambiguous here.
 *
 * `ERR_JWKS_NO_MATCHING_KEY` is deliberately absent. An unrecognized `kid` is the ordinary shape
 * of a forged token, and treating it as an outage would let any caller provoke a 503.
 */
const KEY_SET_UNAVAILABLE_CODES: readonly string[] = [
  errors.JWKSTimeout.code,
  errors.JWKSInvalid.code,
  errors.JOSEError.code,
];

/**
 * Separates "the key set could not be reached" from "this token is not acceptable". Anything the
 * key resolver throws that is not a `jose` error at all — a refused connection, a DNS failure, a
 * socket hang-up — is infrastructure trouble by elimination, since every token-level rejection
 * `jose` raises is a `JOSEError`.
 */
export function isKeySetUnavailable(error: unknown): boolean {
  if (error instanceof errors.JOSEError) {
    return KEY_SET_UNAVAILABLE_CODES.includes(error.code);
  }

  return error instanceof Error;
}

export function buildEntraIssuer(tenantId: string): string {
  return `${ENTRA_AUTHORITY_HOST}/${tenantId}/v2.0`;
}

export function buildEntraJwksUrl(tenantId: string): URL {
  return new URL(`${ENTRA_AUTHORITY_HOST}/${tenantId}/discovery/v2.0/keys`);
}

export interface AzureTokenVerifierOptions {
  tenantId: string;
  audience: string;
  /**
   * Key resolver seam. Defaults to Entra's remote JWKS, which `jose` fetches, caches, and
   * refreshes on key rotation; tests supply a local key set instead of reaching the network.
   */
  getKey?: JWTVerifyGetKey;
}

/**
 * Verifies Microsoft Entra ID v2.0 access tokens issued for this API. The issuer is pinned to
 * the configured directory and the audience to the engine's own app registration, so a validly
 * signed token minted for a different tenant or a different API is still rejected.
 */
export class AzureTokenVerifier implements AdminTokenVerifierPort {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #getKey: JWTVerifyGetKey;

  constructor({ tenantId, audience, getKey }: AzureTokenVerifierOptions) {
    this.#issuer = buildEntraIssuer(tenantId);
    this.#audience = audience;
    this.#getKey = getKey ?? createRemoteJWKSet(buildEntraJwksUrl(tenantId));
  }

  async verify(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.#getKey, {
        issuer: this.#issuer,
        audience: this.#audience,
        algorithms: ['RS256'],
      });

      return payload;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Access token verification failed';

      if (isKeySetUnavailable(error)) {
        throw new AdminTokenVerifierUnavailableError(reason);
      }

      throw new AdminTokenVerificationError(reason);
    }
  }
}
