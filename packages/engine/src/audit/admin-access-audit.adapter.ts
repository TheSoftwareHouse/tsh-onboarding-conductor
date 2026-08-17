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
    tenantId: operator.tenantId,
    userPrincipalName: operator.userPrincipalName,
    grantedRoles: operator.roles,
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
        actorId: event.operator.objectId ?? ADMIN_ACCESS_UNKNOWN_ACTOR,
        metadata: operatorMetadata(event.endpoint.method, event.operator),
      };

    case 'role_missing':
      return {
        ...base,
        action: 'auth.role_missing',
        actorType: 'operator',
        actorId: event.operator.objectId ?? ADMIN_ACCESS_UNKNOWN_ACTOR,
        metadata: {
          ...operatorMetadata(event.endpoint.method, event.operator),
          requiredRoles: event.requiredRoles,
        },
      };

    case 'token_rejected':
      return {
        ...base,
        action: 'auth.token_rejected',
        actorType: 'anonymous',
        actorId: ADMIN_ACCESS_UNKNOWN_ACTOR,
        metadata: {
          method: event.endpoint.method,
          reason: event.reason,
          // Omitted rather than stored as null: a refusal with no readable token should not carry
          // empty claim fields that read as though something had been parsed out of it.
          ...(event.token.issuer !== null ? { tokenIssuer: event.token.issuer } : {}),
          ...(event.token.audience !== null ? { tokenAudience: event.token.audience } : {}),
          ...(event.token.version !== null ? { tokenVersion: event.token.version } : {}),
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
