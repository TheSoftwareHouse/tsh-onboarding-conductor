import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  AdminAccessAuditEvent,
  AdminAccessAuditPort,
  AdminOperatorIdentity,
} from '../auth/admin-access-audit.port';
import { AuditService } from './audit.service';
import {
  ADMIN_ACCESS_UNKNOWN_ACTOR,
  type AdminAccessAuditInput,
  type AdminAccessAuditMetadata,
} from './audit.types';

function operatorMetadata(
  method: string,
  operator: AdminOperatorIdentity,
): AdminAccessAuditMetadata {
  return {
    method,
    email: operator.email,
    platformRole: operator.platformRole,
    organizationId: operator.organizationId,
  };
}

/**
 * Translates an access decision made by the guard into an audit row.
 *
 * Lives in the audit module rather than in `auth` so the guard depends only on its own port: the
 * two modules already reference each other (the audit controller is itself guarded), and keeping
 * the mapping here means the audit schema stays owned by one module.
 */
export function toAdminAccessAuditInput(event: AdminAccessAuditEvent): AdminAccessAuditInput {
  const base = { resourceId: event.endpoint.path };

  switch (event.outcome) {
    case 'granted':
      return {
        ...base,
        action: 'auth.access_granted',
        actorType: 'operator',
        actorId: event.operator.userId,
        metadata: operatorMetadata(event.endpoint.method, event.operator),
      };

    case 'session_missing':
      return {
        ...base,
        action: 'auth.session_missing',
        actorType: 'anonymous',
        actorId: ADMIN_ACCESS_UNKNOWN_ACTOR,
        metadata: { method: event.endpoint.method, reason: event.reason },
      };

    case 'two_factor_required':
      return {
        ...base,
        action: 'auth.two_factor_required',
        actorType: 'operator',
        actorId: event.operator.userId,
        metadata: operatorMetadata(event.endpoint.method, event.operator),
      };

    case 'permission_missing':
      return {
        ...base,
        action: 'auth.permission_missing',
        actorType: 'operator',
        actorId: event.operator.userId,
        metadata: {
          ...operatorMetadata(event.endpoint.method, event.operator),
          ...(event.requiredPermission
            ? {
                requiredPermission: `${event.requiredPermission.resource}:${event.requiredPermission.action}`,
              }
            : {}),
        },
      };

    case 'verification_unavailable':
      return {
        ...base,
        action: 'auth.verification_unavailable',
        actorType: 'anonymous',
        actorId: ADMIN_ACCESS_UNKNOWN_ACTOR,
        metadata: { method: event.endpoint.method, reason: event.reason },
      };

    case 'unauthenticated':
      return {
        ...base,
        action: 'auth.access_unauthenticated',
        actorType: 'anonymous',
        actorId: ADMIN_ACCESS_UNKNOWN_ACTOR,
        metadata: { method: event.endpoint.method },
      };
  }
}

@Injectable()
export class AdminAccessAuditAdapter implements AdminAccessAuditPort {
  constructor(
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async record(event: AdminAccessAuditEvent): Promise<void> {
    await this.auditService.logAdminAccess(this.dataSource, toAdminAccessAuditInput(event));
  }
}
