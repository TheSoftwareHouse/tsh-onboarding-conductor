import type { IncomingHttpHeaders } from 'node:http';
import type { AdminPermission } from './domain/admin-permissions';

export const ADMIN_SESSION_VERIFIER = Symbol('ADMIN_SESSION_VERIFIER');

export type AdminSession = {
  userId: string;
  email: string;
  /** `user.role` from the admin plugin. */
  platformRole: string | null;
  /** A credential user needs TOTP enrolled; a user with no credential account is exempt. */
  twoFactorSatisfied: boolean;
  activeOrganizationId: string | null;
};

export interface AdminSessionVerifierPort {
  /** `null` means no valid session. Throws {@link AdminSessionVerifierUnavailableError} when the store is unreachable. */
  resolve(headers: IncomingHttpHeaders): Promise<AdminSession | null>;
  /** Whether the session's member role in its active organization holds the permission. */
  hasPermission(headers: IncomingHttpHeaders, permission: AdminPermission): Promise<boolean>;
}

/**
 * The session could not be checked at all because the auth store was unreachable. Nothing is
 * known about the caller either way, so it must not be reported as a rejected credential.
 */
export class AdminSessionVerifierUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminSessionVerifierUnavailableError';
  }
}
