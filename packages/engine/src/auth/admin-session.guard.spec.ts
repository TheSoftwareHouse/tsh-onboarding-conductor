import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { AdminAccessAuditEvent, AdminAccessAuditPort } from './admin-access-audit.port';
import {
  AdminSessionVerifierUnavailableError,
  type AdminSession,
  type AdminSessionVerifierPort,
} from './admin-session-verifier.port';
import {
  AdminSessionGuard,
  resolveOperatorId,
  type AdminAuthenticatedRequest,
} from './admin-session.guard';
import type { AdminPermission } from './domain/admin-permissions';
import { AdminPermissionMissingException } from './errors/admin-permission-missing.exception';
import { AdminSessionRequiredException } from './errors/admin-session-required.exception';
import { AuthUnavailableException } from './errors/auth-unavailable.exception';
import { TwoFactorRequiredException } from './errors/two-factor-required.exception';

const PERMISSION: AdminPermission = { resource: 'workflow', action: 'write' };
const ENDPOINT = { method: 'POST', path: '/v1/admin/workflows' };

const MEMBER: AdminSession = {
  userId: 'user-1',
  email: 'anna@tsh.io',
  platformRole: null,
  twoFactorSatisfied: true,
  activeOrganizationId: 'org-1',
};

const MEMBER_IDENTITY = {
  userId: 'user-1',
  email: 'anna@tsh.io',
  platformRole: null,
  organizationId: 'org-1',
};

function createSut({
  enabled = true,
  session = MEMBER as AdminSession | null,
  permitted = true,
  resolveError,
  permission = PERMISSION as AdminPermission | null,
}: {
  enabled?: boolean;
  session?: AdminSession | null;
  permitted?: boolean;
  resolveError?: Error;
  permission?: AdminPermission | null;
} = {}) {
  const verifier = {
    resolve: resolveError
      ? jest.fn().mockRejectedValue(resolveError)
      : jest.fn().mockResolvedValue(session),
    hasPermission: jest.fn().mockResolvedValue(permitted),
  } satisfies AdminSessionVerifierPort;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } satisfies AdminAccessAuditPort;
  const configService = { get: jest.fn().mockReturnValue(enabled) } as unknown as ConfigService;
  const reflector = {
    get: jest.fn().mockReturnValue(permission ?? undefined),
  } as unknown as Reflector;
  const request = {
    headers: { cookie: 'session=abc' },
    method: 'POST',
    path: '/v1/admin/workflows',
  } as unknown as AdminAuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
  } as unknown as ExecutionContext;
  const sut = new AdminSessionGuard(configService, reflector, verifier, audit);

  return { sut, verifier, audit, request, context };
}

function recorded(audit: { record: jest.Mock }): AdminAccessAuditEvent {
  expect(audit.record).toHaveBeenCalledTimes(1);

  return audit.record.mock.calls[0][0];
}

describe('AdminSessionGuard', () => {
  it('grants a user holding superadmin among several roles', async () => {
    const { sut, verifier, context } = createSut({
      session: { ...MEMBER, platformRole: 'user,superadmin', activeOrganizationId: null },
    });

    await expect(sut.canActivate(context)).resolves.toBe(true);
    expect(verifier.hasPermission).not.toHaveBeenCalled();
  });

  it('grants a superadmin without asking the organization', async () => {
    const { sut, verifier, audit, request, context } = createSut({
      session: { ...MEMBER, platformRole: 'superadmin', activeOrganizationId: null },
    });

    await expect(sut.canActivate(context)).resolves.toBe(true);

    expect(verifier.hasPermission).not.toHaveBeenCalled();
    expect(request.adminSession?.userId).toBe('user-1');
    expect(recorded(audit)).toEqual({
      outcome: 'granted',
      endpoint: ENDPOINT,
      operator: { ...MEMBER_IDENTITY, platformRole: 'superadmin', organizationId: null },
    });
  });

  it('grants a member whose organization role holds the route permission', async () => {
    const { sut, verifier, audit, request, context } = createSut();

    await expect(sut.canActivate(context)).resolves.toBe(true);

    expect(verifier.hasPermission).toHaveBeenCalledWith(request.headers, PERMISSION);
    expect(recorded(audit)).toEqual({
      outcome: 'granted',
      endpoint: ENDPOINT,
      operator: MEMBER_IDENTITY,
    });
  });

  it('answers 401 and audits session_missing when there is no session', async () => {
    const { sut, audit, request, context } = createSut({ session: null });

    await expect(sut.canActivate(context)).rejects.toBeInstanceOf(AdminSessionRequiredException);

    expect(request.adminSession).toBeUndefined();
    expect(recorded(audit)).toMatchObject({ outcome: 'session_missing', endpoint: ENDPOINT });
    expect(new AdminSessionRequiredException()).toBeInstanceOf(UnauthorizedException);
  });

  it('answers 403 and audits two_factor_required before looking at permissions', async () => {
    const { sut, verifier, audit, context } = createSut({
      session: { ...MEMBER, platformRole: 'superadmin', twoFactorSatisfied: false },
    });

    await expect(sut.canActivate(context)).rejects.toBeInstanceOf(TwoFactorRequiredException);

    expect(verifier.hasPermission).not.toHaveBeenCalled();
    expect(recorded(audit)).toEqual({
      outcome: 'two_factor_required',
      endpoint: ENDPOINT,
      operator: { ...MEMBER_IDENTITY, platformRole: 'superadmin' },
    });
    expect(new TwoFactorRequiredException()).toBeInstanceOf(ForbiddenException);
  });

  it('answers 403 and audits permission_missing for a member lacking the permission', async () => {
    const { sut, audit, request, context } = createSut({ permitted: false });

    await expect(sut.canActivate(context)).rejects.toBeInstanceOf(AdminPermissionMissingException);

    // The denied operator stays on the request so the failure filter attributes its row to them.
    expect(request.adminSession?.userId).toBe('user-1');
    expect(recorded(audit)).toEqual({
      outcome: 'permission_missing',
      endpoint: ENDPOINT,
      operator: MEMBER_IDENTITY,
      requiredPermission: PERMISSION,
    });
  });

  it('denies a non-superadmin with no active organization without asking the verifier', async () => {
    const { sut, verifier, audit, context } = createSut({
      session: { ...MEMBER, activeOrganizationId: null },
    });

    await expect(sut.canActivate(context)).rejects.toBeInstanceOf(AdminPermissionMissingException);

    expect(verifier.hasPermission).not.toHaveBeenCalled();
    expect(recorded(audit)).toMatchObject({
      outcome: 'permission_missing',
      operator: { ...MEMBER_IDENTITY, organizationId: null },
    });
  });

  it('denies a member on a route that declares no permission', async () => {
    const { sut, verifier, audit, context } = createSut({ permission: null });

    await expect(sut.canActivate(context)).rejects.toBeInstanceOf(AdminPermissionMissingException);

    expect(verifier.hasPermission).not.toHaveBeenCalled();
    expect(recorded(audit)).toMatchObject({ outcome: 'permission_missing' });
  });

  it('answers 503 and audits verification_unavailable when the session lookup fails', async () => {
    const { sut, audit, context } = createSut({
      resolveError: new AdminSessionVerifierUnavailableError('db down'),
    });

    await expect(sut.canActivate(context)).rejects.toBeInstanceOf(AuthUnavailableException);

    expect(recorded(audit)).toEqual({
      outcome: 'verification_unavailable',
      endpoint: ENDPOINT,
      reason: 'db down',
    });
  });

  it('answers 503 when the permission lookup cannot reach the store', async () => {
    const { sut, verifier, audit, context } = createSut();
    verifier.hasPermission.mockRejectedValue(new AdminSessionVerifierUnavailableError('db down'));

    await expect(sut.canActivate(context)).rejects.toBeInstanceOf(AuthUnavailableException);

    expect(recorded(audit)).toMatchObject({ outcome: 'verification_unavailable' });
  });

  it('lets an unexpected error through rather than reporting it as an outage', async () => {
    const { sut, audit, context } = createSut({ resolveError: new Error('boom') });

    await expect(sut.canActivate(context)).rejects.toThrow('boom');

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records unauthenticated and lets the request through when admin auth is disabled', async () => {
    const { sut, verifier, audit, request, context } = createSut({ enabled: false });

    await expect(sut.canActivate(context)).resolves.toBe(true);

    expect(verifier.resolve).not.toHaveBeenCalled();
    expect(request.adminSession).toBeUndefined();
    expect(recorded(audit)).toEqual({ outcome: 'unauthenticated', endpoint: ENDPOINT });
  });

  it('does not fail the request when the audit write fails', async () => {
    const { sut, audit, context } = createSut();
    audit.record.mockRejectedValue(new Error('connection terminated'));

    await expect(sut.canActivate(context)).resolves.toBe(true);
    await expect(sut.onModuleDestroy()).resolves.toBeUndefined();
  });
});

describe('resolveOperatorId', () => {
  it('names the session user, or the unknown actor without a session', () => {
    expect(resolveOperatorId(MEMBER)).toBe('user-1');
    expect(resolveOperatorId(undefined)).toBe('unknown');
  });
});
