import { DataSource } from 'typeorm';
import type { AdminAccessAuditEvent, AdminOperatorIdentity } from '../auth/admin-access-audit.port';
import { AdminAccessAuditAdapter, toAdminAccessAuditInput } from './admin-access-audit.adapter';
import { AuditService } from './audit.service';

const ENDPOINT = { method: 'GET', path: '/v1/onboardings' };

const OPERATOR: AdminOperatorIdentity = {
  objectId: '9f3c0000-0000-0000-0000-00000000000a',
  userPrincipalName: 'anna.kowalska@tsh.io',
  tenantId: '11111111-1111-1111-1111-111111111111',
  roles: ['admin'],
};

describe('toAdminAccessAuditInput', () => {
  it('attributes a granted read to the operator, keyed on the immutable object id', () => {
    expect(
      toAdminAccessAuditInput({ outcome: 'granted', endpoint: ENDPOINT, operator: OPERATOR }),
    ).toEqual({
      action: 'auth.access_granted',
      actorType: 'operator',
      actorId: '9f3c0000-0000-0000-0000-00000000000a',
      resourceId: '/v1/onboardings',
      metadata: {
        method: 'GET',
        tenantId: '11111111-1111-1111-1111-111111111111',
        userPrincipalName: 'anna.kowalska@tsh.io',
        grantedRoles: ['admin'],
      },
    });
  });

  it('records what a role refusal was measured against, not only what the operator held', () => {
    const event: AdminAccessAuditEvent = {
      outcome: 'role_missing',
      endpoint: ENDPOINT,
      operator: { ...OPERATOR, roles: ['auditor'] },
      requiredRoles: ['admin', 'compliance'],
    };

    expect(toAdminAccessAuditInput(event)).toEqual({
      action: 'auth.role_missing',
      actorType: 'operator',
      actorId: '9f3c0000-0000-0000-0000-00000000000a',
      resourceId: '/v1/onboardings',
      metadata: {
        method: 'GET',
        tenantId: '11111111-1111-1111-1111-111111111111',
        userPrincipalName: 'anna.kowalska@tsh.io',
        grantedRoles: ['auditor'],
        requiredRoles: ['admin', 'compliance'],
      },
    });
  });

  it('keeps a rejected token anonymous while preserving the claims it presented', () => {
    const event: AdminAccessAuditEvent = {
      outcome: 'token_rejected',
      endpoint: ENDPOINT,
      reason: 'unexpected "iss" claim value',
      token: {
        issuer: 'https://sts.windows.net/other-tenant/',
        audience: 'some-audience',
        version: '1.0',
      },
    };

    expect(toAdminAccessAuditInput(event)).toEqual({
      action: 'auth.token_rejected',
      actorType: 'anonymous',
      actorId: 'unknown',
      resourceId: '/v1/onboardings',
      metadata: {
        method: 'GET',
        reason: 'unexpected "iss" claim value',
        tokenIssuer: 'https://sts.windows.net/other-tenant/',
        tokenAudience: 'some-audience',
        tokenVersion: '1.0',
      },
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

  it('omits the claim fields entirely when the rejected token was unreadable', () => {
    // Storing them as null would read as though claims had been parsed and found empty.
    const event: AdminAccessAuditEvent = {
      outcome: 'token_rejected',
      endpoint: ENDPOINT,
      reason: 'Missing bearer access token',
      token: { issuer: null, audience: null, version: null },
    };

    expect(toAdminAccessAuditInput(event).metadata).toEqual({
      method: 'GET',
      reason: 'Missing bearer access token',
    });
  });

  it('falls back to an unknown actor when a verified token names nobody', () => {
    const event: AdminAccessAuditEvent = {
      outcome: 'granted',
      endpoint: ENDPOINT,
      operator: { objectId: null, userPrincipalName: null, tenantId: null, roles: [] },
    };

    expect(toAdminAccessAuditInput(event).actorId).toBe('unknown');
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
      actorId: '9f3c0000-0000-0000-0000-00000000000a',
      resourceId: '/v1/onboardings',
      metadata: {
        method: 'GET',
        tenantId: '11111111-1111-1111-1111-111111111111',
        userPrincipalName: 'anna.kowalska@tsh.io',
        grantedRoles: ['admin'],
      },
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
