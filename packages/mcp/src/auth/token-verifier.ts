import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { AuthUnavailableError, TokenRejectedError } from './auth.errors';
import { buildEntraIssuer, buildEntraJwksUrl } from './entra';

/**
 * Allowance for clock skew between this host and Entra, in seconds. `jose` defaults to none, so a
 * host a second behind would reject a freshly minted token as "not active yet".
 */
export const CLOCK_TOLERANCE_SECONDS = 60;

/**
 * `jose` failures that mean the key set could not be fetched or understood, not that the token was
 * bad. `ERR_JWKS_NO_MATCHING_KEY` is deliberately absent: an unknown `kid` is the ordinary shape of
 * a forged token, and treating it as an outage would let any caller provoke a 503.
 */
const KEY_SET_UNAVAILABLE_CODES: readonly string[] = [
  errors.JWKSTimeout.code,
  errors.JWKSInvalid.code,
  errors.JOSEError.code,
];

/**
 * Anything the key resolver throws that is not a `jose` error — a refused connection, a DNS
 * failure — is infrastructure trouble by elimination, since every token-level rejection `jose`
 * raises is a `JOSEError`.
 */
function isKeySetUnavailable(error: unknown): boolean {
  if (error instanceof errors.JOSEError) {
    return KEY_SET_UNAVAILABLE_CODES.includes(error.code);
  }

  return error instanceof Error;
}

export interface TokenVerifierOptions {
  tenantId: string;
  /** The MCP app registration's client id: the only audience this server accepts. */
  audience: string;
  /** The delegated scope the token's `scp` claim must carry. */
  requiredScope: string;
  /** Key resolver seam: Entra's remote JWKS by default, a local key set in tests. */
  getKey?: JWTVerifyGetKey;
}

/**
 * Verifies Entra ID v2.0 access tokens issued for this server: RS256 only, issuer pinned to the
 * configured directory, audience to the MCP app registration, and the required delegated scope
 * present. A validly signed token for another tenant, another API or without the scope is rejected.
 */
export class TokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly requiredScope: string;
  private readonly getKey: JWTVerifyGetKey;

  constructor({ tenantId, audience, requiredScope, getKey }: TokenVerifierOptions) {
    this.issuer = buildEntraIssuer(tenantId);
    this.audience = audience;
    this.requiredScope = requiredScope;
    this.getKey = getKey ?? createRemoteJWKSet(buildEntraJwksUrl(tenantId));
  }

  async verify(token: string): Promise<JWTPayload> {
    const payload = await this.readPayload(token);

    if (!readScopes(payload.scp).includes(this.requiredScope)) {
      throw new TokenRejectedError(`Token lacks the required scope ${this.requiredScope}`);
    }

    return payload;
  }

  private async readPayload(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.getKey, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });

      return payload;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Access token verification failed';

      if (isKeySetUnavailable(error)) {
        throw new AuthUnavailableError(reason);
      }

      throw new TokenRejectedError(reason);
    }
  }
}

/** `scp` is one space-delimited string in an Entra delegated token; anything else carries none. */
function readScopes(claim: unknown): string[] {
  return typeof claim === 'string' ? claim.split(' ').filter((scope) => scope !== '') : [];
}
