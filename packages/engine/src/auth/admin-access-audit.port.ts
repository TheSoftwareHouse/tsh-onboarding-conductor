import type { AdminPermission } from './domain/admin-permissions';

export const ADMIN_ACCESS_AUDIT = Symbol('ADMIN_ACCESS_AUDIT');

/** The admin route a decision was made about. */
export type AdminAccessEndpoint = {
  method: string;
  path: string;
};

/**
 * Identity of the operator behind a session the verifier accepted. `userId` is what the trail is
 * keyed on; the email is recorded as a convenience for whoever reads it.
 */
export type AdminOperatorIdentity = {
  userId: string;
  email: string;
  platformRole: string | null;
  organizationId: string | null;
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
      outcome: 'session_missing';
      endpoint: AdminAccessEndpoint;
      reason: string;
    }
  | {
      outcome: 'two_factor_required';
      endpoint: AdminAccessEndpoint;
      operator: AdminOperatorIdentity;
    }
  | {
      outcome: 'permission_missing';
      endpoint: AdminAccessEndpoint;
      operator: AdminOperatorIdentity;
      requiredPermission: AdminPermission | undefined;
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
