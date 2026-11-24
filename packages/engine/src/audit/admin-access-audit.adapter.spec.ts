import { DataSource } from 'typeorm';
import type { AdminAccessAuditEvent, AdminOperatorIdentity } from '../auth/admin-access-audit.port';
import { AdminAccessAuditAdapter, toAdminAccessAuditInput } from './admin-access-audit.adapter';
import { AuditService } from './audit.service';

const ENDPOINT = { method: 'GET', path: '/v1/onboardings' };

const OPERATOR: AdminOperatorIdentity = {
  userId: 'user-1',
  email: 'anna.kowalska@tsh.io',
  platformRole: null,
  organizationId: 'org-1',
};

const OPERATOR_METADATA = {
  method: 'GET',
  email: 'anna.kowalska@tsh.io',
  platformRole: null,
  organizationId: 'org-1',
};

describe('toAdminAccessAuditInput', () => {
  it('attributes a granted read to the operator, keyed on the user id', () => {
    expect(
      toAdminAccessAuditInput({ outcome: 'granted', endpoint: ENDPOINT, operator: OPERATOR }),
    ).toEqual({
      action: 'auth.access_granted',
      actorType: 'operator',
      actorId: 'user-1',
      resourceId: '/v1/onboardings',
      metadata: OPERATOR_METADATA,
    });
  });

  it('keeps a missing session anonymous', () => {
    expect(
      toAdminAccessAuditInput({
        outcome: 'session_missing',
        endpoint: ENDPOINT,
        reason: 'No valid session',
      }),
    ).toEqual({
      action: 'auth.session_missing',
      actorType: 'anonymous',
      actorId: 'unknown',
      resourceId: '/v1/onboardings',
      metadata: { method: 'GET', reason: 'No valid session' },
    });
  });

  it('keeps a refused origin anonymous and records the origin', () => {
    expect(
      toAdminAccessAuditInput({
        outcome: 'origin_refused',
        endpoint: { method: 'POST', path: '/v1/onboardings' },
        origin: 'https://evil.tsh.io',
      }),
    ).toEqual({
      action: 'auth.origin_refused',
      actorType: 'anonymous',
      actorId: 'unknown',
      resourceId: '/v1/onboardings',
      metadata: { method: 'POST', origin: 'https://evil.tsh.io' },
    });
  });

  it('records the permission a refusal was measured against', () => {
    expect(
      toAdminAccessAuditInput({
        outcome: 'permission_missing',
        endpoint: ENDPOINT,
        operator: OPERATOR,
        requiredPermission: { resource: 'workflow', action: 'write' },
      }),
    ).toEqual({
      action: 'auth.permission_missing',
      actorType: 'operator',
      actorId: 'user-1',
      resourceId: '/v1/onboardings',
      metadata: { ...OPERATOR_METADATA, requiredPermission: 'workflow:write' },
    });
  });

  it('records an unreachable key set as an engine fault, with no operator attached', () => {
    const event: AdminAccessAuditEvent = {
      outcome: 'verification_unavailable',
      endpoint: ENDPOINT,
      reason: 'request timed out',
    };

    expect(toAdminAccessAuditInput(event)).toEqual({
      action: 'auth.verification_unavailable',
      actorType: 'anonymous',
      actorId: 'unknown',
      resourceId: '/v1/onboardings',
      metadata: { method: 'GET', reason: 'request timed out' },
    });
  });

  it('records an escape-hatch read, which has no identity precisely because none was demanded', () => {
    expect(toAdminAccessAuditInput({ outcome: 'unauthenticated', endpoint: ENDPOINT })).toEqual({
      action: 'auth.access_unauthenticated',
      actorType: 'anonymous',
      actorId: 'unknown',
      resourceId: '/v1/onboardings',
      metadata: { method: 'GET' },
    });
  });
});

describe('AdminAccessAuditAdapter', () => {
  it('writes the translated decision through the audit service', async () => {
    const auditService = { logAdminAccess: jest.fn().mockResolvedValue(undefined) };
    const dataSource = {} as DataSource;
    const sut = new AdminAccessAuditAdapter(auditService as unknown as AuditService, dataSource);

    await sut.record({ outcome: 'granted', endpoint: ENDPOINT, operator: OPERATOR });

    expect(auditService.logAdminAccess).toHaveBeenCalledWith(dataSource, {
      action: 'auth.access_granted',
      actorType: 'operator',
      actorId: 'user-1',
      resourceId: '/v1/onboardings',
      metadata: OPERATOR_METADATA,
    });
  });

  it('propagates a write failure so the guard can report it', async () => {
    const auditService = {
      logAdminAccess: jest.fn().mockRejectedValue(new Error('connection terminated')),
    };
    const sut = new AdminAccessAuditAdapter(
      auditService as unknown as AuditService,
      {} as DataSource,
    );

    await expect(sut.record({ outcome: 'unauthenticated', endpoint: ENDPOINT })).rejects.toThrow(
      'connection terminated',
    );
  });
});
