export const ADMIN_ACCESS_AUDIT = Symbol('ADMIN_ACCESS_AUDIT');

/** The admin route a decision was made about. */
export type AdminAccessEndpoint = {
  method: string;
  path: string;
};

/**
 * Identity read out of a token the verifier already accepted, so these values carry the tenant's
 * word for who the caller is. `objectId` is Entra's immutable per-directory user id and is what
 * the trail is keyed on; a user principal name can be reassigned, so it is recorded as a
 * convenience for whoever reads the log rather than as the identifier.
 */
export type AdminOperatorIdentity = {
  objectId: string | null;
  userPrincipalName: string | null;
  tenantId: string | null;
  roles: readonly string[];
};

/**
 * `iss`, `aud` and `ver` read out of a token that was *not* accepted. Entirely attacker-controlled
 * — recorded so an operator can tell a misconfigured app registration from a forged credential,
 * never trusted for a decision.
 */
export type UnverifiedTokenDescriptor = {
  issuer: string | null;
  audience: string | null;
  version: string | null;
};

export const EMPTY_TOKEN_DESCRIPTOR: UnverifiedTokenDescriptor = {
  issuer: null,
  audience: null,
  version: null,
};

/**
 * Every outcome the guard can reach. `unauthenticated` is the local escape hatch
 * (`ADMIN_AUTH_ENABLED=false`) serving admin data with no credential at all: there is no identity
 * to record, which is precisely why the read still has to leave a trace.
 */
export type AdminAccessAuditEvent =
  | {
      outcome: 'granted';
      endpoint: AdminAccessEndpoint;
      operator: AdminOperatorIdentity;
    }
  | {
      outcome: 'role_missing';
      endpoint: AdminAccessEndpoint;
      operator: AdminOperatorIdentity;
      requiredRoles: readonly string[];
    }
  | {
      outcome: 'token_rejected';
      endpoint: AdminAccessEndpoint;
      reason: string;
      token: UnverifiedTokenDescriptor;
    }
  | {
      outcome: 'verification_unavailable';
      endpoint: AdminAccessEndpoint;
      reason: string;
    }
  | {
      outcome: 'unauthenticated';
      endpoint: AdminAccessEndpoint;
    };

/**
 * Records an admin access decision. Implementations must be safe to call without awaiting: the
 * guard treats auditing as best effort so a database outage cannot take the admin endpoints down
 * with it, and reports a failed write on the engine's own logger instead.
 */
export interface AdminAccessAuditPort {
  record(event: AdminAccessAuditEvent): Promise<void>;
}
