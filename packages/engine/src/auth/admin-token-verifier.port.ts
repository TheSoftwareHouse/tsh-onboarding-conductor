import type { JWTPayload } from 'jose';

export const ADMIN_TOKEN_VERIFIER = Symbol('ADMIN_TOKEN_VERIFIER');

/**
 * Verifies an admin access token. Implementations must reject anything they cannot fully
 * validate by throwing; returning a payload always means the token was trusted.
 */
export interface AdminTokenVerifierPort {
  verify(token: string): Promise<JWTPayload>;
}

export class AdminTokenVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminTokenVerificationError';
  }
}
