import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import {
  AdminTokenVerificationError,
  type AdminTokenVerifierPort,
} from './admin-token-verifier.port';

export const ENTRA_AUTHORITY_HOST = 'https://login.microsoftonline.com';

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
      throw new AdminTokenVerificationError(
        error instanceof Error ? error.message : 'Access token verification failed',
      );
    }
  }
}
