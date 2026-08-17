import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JWTPayload } from 'jose';
import {
  AdminTokenVerificationError,
  type AdminTokenVerifierPort,
} from './admin-token-verifier.port';
import { AzureJwtGuard, hasAnyRequiredRole, readBearerToken } from './azure-jwt.guard';

type TestRequest = {
  headers: Record<string, string | undefined>;
  adminTokenClaims?: JWTPayload;
};

function createContext(request: TestRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function createConfigService(adminAuthEnabled: boolean, requiredRoles = 'admin'): ConfigService {
  return {
    get: jest.fn((key: string) =>
      key === 'ADMIN_REQUIRED_ROLES' ? requiredRoles : adminAuthEnabled,
    ),
  } as unknown as ConfigService;
}

describe('readBearerToken', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc.def.ghi', 'abc.def.ghi'],
    ['Bearer   abc.def.ghi  ', 'abc.def.ghi'],
  ])('reads %s', (header, expected) => {
    expect(readBearerToken(header)).toBe(expected);
  });

  it.each([[undefined], [''], ['Bearer'], ['Bearer    '], ['Basic dXNlcjpwYXNz'], ['abc.def.ghi']])(
    'returns null for %s',
    (header) => {
      expect(readBearerToken(header)).toBeNull();
    },
  );

  it('returns null for a repeated header, which cannot be a single credential', () => {
    expect(readBearerToken(['Bearer one', 'Bearer two'])).toBeNull();
  });
});

describe('hasAnyRequiredRole', () => {
  it('accepts a token holding one of the allowed roles', () => {
    expect(hasAnyRequiredRole(['auditor', 'admin'], ['admin'])).toBe(true);
  });

  it('accepts any single role from a multi-role allowlist', () => {
    expect(hasAnyRequiredRole(['compliance'], ['admin', 'compliance', 'auditor'])).toBe(true);
  });

  it('ignores case so a portal Value and the configured spelling cannot drift apart', () => {
    expect(hasAnyRequiredRole(['Admin'], ['admin'])).toBe(true);
    expect(hasAnyRequiredRole(['admin'], ['ADMIN'])).toBe(true);
  });

  it('rejects a token holding only other roles', () => {
    expect(hasAnyRequiredRole(['auditor', 'compliance'], ['admin'])).toBe(false);
  });

  it.each([[undefined], [null], ['admin'], [[]], [[42]]])(
    'rejects a roles claim of %p, which an unassigned account produces',
    (claim) => {
      expect(hasAnyRequiredRole(claim, ['admin'])).toBe(false);
    },
  );

  it('rejects everything when no role is configured, rather than letting all callers through', () => {
    expect(hasAnyRequiredRole(['admin'], [])).toBe(false);
  });
});

describe('AzureJwtGuard', () => {
  const claims: JWTPayload = { sub: 'operator-object-id', roles: ['admin'] };
  let verifier: AdminTokenVerifierPort;

  beforeEach(() => {
    verifier = { verify: jest.fn().mockResolvedValue(claims) };
  });

  it('allows a request carrying a verifiable token and exposes the claims', async () => {
    const guard = new AzureJwtGuard(createConfigService(true), verifier);
    const request: TestRequest = { headers: { authorization: 'Bearer valid.token' } };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(verifier.verify).toHaveBeenCalledWith('valid.token');
    expect(request.adminTokenClaims).toBe(claims);
  });

  it('rejects a request without an Authorization header', async () => {
    const guard = new AzureJwtGuard(createConfigService(true), verifier);

    await expect(guard.canActivate(createContext({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('rejects a request whose token fails verification, as 401 rather than 500', async () => {
    verifier.verify = jest.fn().mockRejectedValue(new AdminTokenVerificationError('expired'));
    const guard = new AzureJwtGuard(createConfigService(true), verifier);
    const context = createContext({ headers: { authorization: 'Bearer expired.token' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not leak the verification failure detail to the caller', async () => {
    verifier.verify = jest
      .fn()
      .mockRejectedValue(new AdminTokenVerificationError('unexpected "iss" claim value'));
    const guard = new AzureJwtGuard(createConfigService(true), verifier);
    const context = createContext({ headers: { authorization: 'Bearer wrong.issuer' } });

    await expect(guard.canActivate(context)).rejects.toThrow('Invalid access token');
  });

  it('answers 403, not 401, when the token carries no assigned role', async () => {
    verifier.verify = jest.fn().mockResolvedValue({ sub: 'operator-object-id' });
    const guard = new AzureJwtGuard(createConfigService(true), verifier);
    const context = createContext({ headers: { authorization: 'Bearer valid.token' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 403 when the token carries only roles outside the allowlist', async () => {
    verifier.verify = jest.fn().mockResolvedValue({ sub: 'x', roles: ['auditor', 'compliance'] });
    const guard = new AzureJwtGuard(createConfigService(true, 'admin'), verifier);
    const context = createContext({ headers: { authorization: 'Bearer valid.token' } });

    await expect(guard.canActivate(context)).rejects.toThrow(/one of: admin/);
  });

  it('allows a role named anywhere in a multi-role allowlist', async () => {
    verifier.verify = jest.fn().mockResolvedValue({ sub: 'x', roles: ['auditor'] });
    const guard = new AzureJwtGuard(createConfigService(true, 'admin,auditor'), verifier);
    const context = createContext({ headers: { authorization: 'Bearer valid.token' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows every request when admin auth is disabled', async () => {
    const guard = new AzureJwtGuard(createConfigService(false), null);

    await expect(guard.canActivate(createContext({ headers: {} }))).resolves.toBe(true);
  });
});
