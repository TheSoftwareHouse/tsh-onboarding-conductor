import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import {
  ADMIN_ACCESS_AUDIT,
  type AdminAccessAuditEvent,
  type AdminAccessAuditPort,
  type AdminAccessEndpoint,
  type AdminOperatorIdentity,
} from './admin-access-audit.port';
import {
  ADMIN_SESSION_VERIFIER,
  AdminSessionVerifierUnavailableError,
  type AdminSession,
  type AdminSessionVerifierPort,
} from './admin-session-verifier.port';
import { hasSuperadminRole, type AdminPermission } from './domain/admin-permissions';
import { AdminPermissionMissingException } from './errors/admin-permission-missing.exception';
import { AdminSessionRequiredException } from './errors/admin-session-required.exception';
import { AuthUnavailableException } from './errors/auth-unavailable.exception';

/** Metadata key `AdminRoute(permission)` writes on a handler and this guard reads. */
export const ADMIN_PERMISSION_METADATA = 'admin:permission';

const MAX_LOGGED_VALUE_LENGTH = 200;

/** Clips an untrusted value so a single request cannot flood a log line or an audit row. */
function clipValue(text: string): string {
  return text.length > MAX_LOGGED_VALUE_LENGTH
    ? `${text.slice(0, MAX_LOGGED_VALUE_LENGTH)}…`
    : text;
}

/**
 * Renders an untrusted value for a log line. JSON-quoting escapes the newlines that would
 * otherwise let a crafted value forge whole log entries; clipping stops it flooding the log.
 */
function quoteForLog(value: unknown): string {
  return JSON.stringify(clipValue(String(value)));
}

/**
 * Names the admin route for the audit trail. The registered route pattern is preferred over the
 * concrete path so that parameterized routes aggregate into one auditable resource rather than
 * one per id. The query string is deliberately left out: admin filters can carry the very
 * identifiers the trail exists to protect.
 */
function readEndpoint(request: Request): AdminAccessEndpoint {
  const path = request.route?.path ?? request.path ?? 'unknown';

  return {
    method: (request.method ?? 'UNKNOWN').toUpperCase(),
    path: clipValue(path),
  };
}

/**
 * An Express request as an admin controller or filter sees it: the one property this guard adds
 * once a session is accepted. Absent entirely when `ADMIN_AUTH_ENABLED=false`, because the guard
 * never resolves a session then.
 */
export type AdminAuthenticatedRequest = Request & { adminSession?: AdminSession };

/**
 * The actor id an admin write is filed against in the audit trail. With `ADMIN_AUTH_ENABLED=false`
 * the guard sets no session at all, which is exactly the unknown-actor case the trail records
 * rather than attributing the write to nobody.
 */
export function resolveOperatorId(session: AdminSession | undefined): string {
  return session?.userId ?? ADMIN_ACCESS_UNKNOWN_ACTOR;
}

function toOperator(session: AdminSession): AdminOperatorIdentity {
  return {
    userId: session.userId,
    email: clipValue(session.email),
    platformRole: session.platformRole,
    organizationId: session.activeOrganizationId,
  };
}

/**
 * Protects the admin endpoints with a better-auth session. Decision order:
 *
 * 1. `ADMIN_AUTH_ENABLED` off: record `unauthenticated` and let the request through.
 * 2. No valid session: 401 `ADMIN_SESSION_REQUIRED`.
 * 3. A `superadmin` platform role is granted; otherwise the member's role in the active
 *    organization must hold the route's permission, else 403 `ADMIN_PERMISSION_MISSING`
 *    (also when there is no active organization, or the route declares no permission).
 * 4. The auth store unreachable at any step: 503 `AUTH_UNAVAILABLE`.
 *
 * Every decision — including the successful ones — is written to the audit log. Where a decision
 * is logged as well as audited, the log event is the upper-snake form of the audit action —
 * `AUTH_SESSION_MISSING` for `auth.session_missing` — so an operator reading the logs can query
 * the matching rows without a translation table. Successes are audited only.
 *
 * Denial throws are deliberately **not** marked with `markAuditRecorded`. `recordAccess` is
 * fire-and-forget, so at the moment a denial is thrown the `auth.*` write has not merely gone
 * unconfirmed — it has not even been attempted. Marking the throw would suppress the global
 * `ApiFailureAuditFilter`'s `api.*` row unconditionally, so a database blip during a denial would
 * leave **zero** audit evidence of it. Auth denials are the highest-value security evidence in the
 * trail, so every denial writes both an `auth.*` row and an `api.request_rejected` row — a
 * guaranteed duplicate, chosen deliberately over a possible zero.
 */
@Injectable()
export class AdminSessionGuard implements CanActivate, OnModuleDestroy {
  private readonly logger = new Logger(AdminSessionGuard.name);

  /**
   * Audit writes that have been started and not yet settled. `recordAccess` deliberately does
   * not await them, so the pending promise is otherwise the only thing holding on to a write,
   * and nothing at shutdown knows it is there.
   */
  private readonly pendingAuditWrites = new Set<Promise<void>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    @Inject(ADMIN_SESSION_VERIFIER) private readonly verifier: AdminSessionVerifierPort | null,
    @Inject(ADMIN_ACCESS_AUDIT) private readonly accessAudit: AdminAccessAuditPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminAuthenticatedRequest>();
    const endpoint = readEndpoint(request);

    if (this.configService.get<boolean>('ADMIN_AUTH_ENABLED') !== true || !this.verifier) {
      // Admin data is being served with no credential demanded of the caller. There is no
      // identity to attribute it to, which is exactly why the read still has to be recorded.
      this.recordAccess({ outcome: 'unauthenticated', endpoint });

      return true;
    }

    const permission = this.reflector.get<AdminPermission | undefined>(
      ADMIN_PERMISSION_METADATA,
      context.getHandler(),
    );

    try {
      return await this.decide(request, endpoint, this.verifier, permission);
    } catch (error) {
      if (!(error instanceof AdminSessionVerifierUnavailableError)) {
        throw error;
      }

      // The auth store could not be reached, so nothing is known about this caller. Answering 401
      // would send every operator off to sign in again over what is an engine-side fault.
      this.logger.error(`AUTH_VERIFICATION_UNAVAILABLE reason=${quoteForLog(error.message)}`);
      this.recordAccess({
        outcome: 'verification_unavailable',
        endpoint,
        reason: clipValue(error.message),
      });

      throw new AuthUnavailableException();
    }
  }

  private async decide(
    request: AdminAuthenticatedRequest,
    endpoint: AdminAccessEndpoint,
    verifier: AdminSessionVerifierPort,
    permission: AdminPermission | undefined,
  ): Promise<boolean> {
    const session = await verifier.resolve(request.headers);

    if (!session) {
      this.recordAccess({
        outcome: 'session_missing',
        endpoint,
        reason: 'No valid admin session',
      });

      throw new AdminSessionRequiredException();
    }

    // Assigned before the checks below so a 403 still leaves the request carrying the operator
    // who was denied: the global `ApiFailureAuditFilter` can then attribute its paired
    // `api.request_rejected` row to the same operator named in the `auth.*` row.
    request.adminSession = session;

    const operator = toOperator(session);

    const permitted =
      hasSuperadminRole(session.platformRole) ||
      (session.activeOrganizationId !== null &&
        permission !== undefined &&
        (await verifier.hasPermission(request.headers, permission)));

    if (!permitted) {
      this.logger.warn(
        `AUTH_PERMISSION_MISSING userId=${quoteForLog(session.userId)} required=${quoteForLog(
          permission ? `${permission.resource}:${permission.action}` : 'none declared',
        )}`,
      );
      this.recordAccess({
        outcome: 'permission_missing',
        endpoint,
        operator,
        requiredPermission: permission,
      });

      throw new AdminPermissionMissingException();
    }

    this.recordAccess({ outcome: 'granted', endpoint, operator });

    return true;
  }

  /**
   * Auditing is best effort by design: a failed write is reported on the engine's own logger but
   * never converted into a failed request, so a database outage cannot take the admin endpoints
   * down with it. The trade is a gap in the trail during such an outage, which the
   * `AUTH_AUDIT_WRITE_FAILED` line makes visible.
   */
  private recordAccess(event: AdminAccessAuditEvent): void {
    const write = this.accessAudit.record(event).catch((error: unknown) => {
      this.logger.error(
        `AUTH_AUDIT_WRITE_FAILED outcome=${event.outcome} method=${quoteForLog(
          event.endpoint.method,
        )} path=${quoteForLog(event.endpoint.path)} reason=${quoteForLog(
          error instanceof Error ? error.message : 'unknown',
        )}`,
      );
    });

    this.pendingAuditWrites.add(write);
    void write.finally(() => this.pendingAuditWrites.delete(write));
  }

  /**
   * Lets the writes already in flight reach the database before the rest of the shutdown pulls
   * it away from them. Nest runs `onModuleDestroy` ahead of the `onApplicationShutdown` hook
   * that destroys the TypeORM data source, so without this a restart drops the audit rows for
   * every admin request still being served.
   *
   * One pass over what is outstanding, not a loop until the set empties: the HTTP server is
   * still accepting requests until `dispose` closes it a moment later, and a shutdown that
   * waits for traffic to stop arriving is a worse failure than the occasional missed row that
   * `recordAccess` already logs.
   */
  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.pendingAuditWrites);
  }
}
