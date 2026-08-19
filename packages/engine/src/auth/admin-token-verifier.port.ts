import type { JWTPayload } from 'jose';

export const ADMIN_TOKEN_VERIFIER = Symbol('ADMIN_TOKEN_VERIFIER');

/**
 * Verifies an admin access token. Implementations must reject anything they cannot fully
 * validate by throwing; returning a payload always means the token was trusted.
 */
export interface AdminTokenVerifierPort {
  verify(token: string): Promise<JWTPayload>;
}

/** The token was read and found unacceptable: bad signature, wrong issuer or audience, expired. */
export class AdminTokenVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminTokenVerificationError';
  }
}

/**
 * The token could not be checked at all, because the signing key set was unreachable, timed out,
 * or came back unusable. Nothing is known about the token either way, so this must not be
 * reported as a rejected credential — it is an engine-side fault.
 */
export class AdminTokenVerifierUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminTokenVerifierUnavailableError';
  }
}
