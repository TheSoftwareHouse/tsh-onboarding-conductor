import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JWTPayload } from 'jose';
import {
  AdminTokenVerificationError,
  AdminTokenVerifierUnavailableError,
  type AdminTokenVerifierPort,
} from './admin-token-verifier.port';
import {
  AzureJwtGuard,
  describeUnverifiedToken,
  hasAnyRequiredRole,
  quoteForLog,
  readBearerToken,
} from './azure-jwt.guard';

function encodeTokenWithClaims(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');

  return `header.${payload}.signature`;
}

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

describe('quoteForLog', () => {
  it('escapes the newlines a crafted token would use to forge log entries', () => {
    const forged = quoteForLog('https://evil\nADMIN_TOKEN_ACCEPTED reason=ok');

    expect(forged).not.toContain('\n');
    expect(forged).toContain('\\n');
  });

  it.each([['\r'], ['\t'], ['\u0000'], ['\u001b']])(
    'escapes the control character %j',
    (character) => {
      expect(quoteForLog(`iss${character}`)).not.toContain(character);
    },
  );

  it('clips an oversized value so one token cannot flood the log', () => {
    expect(quoteForLog('a'.repeat(5000)).length).toBeLessThan(250);
  });

  it('still renders ordinary values readably', () => {
    expect(quoteForLog('https://sts.windows.net/tenant/')).toBe(
      '"https://sts.windows.net/tenant/"',
    );
  });
});

describe('describeUnverifiedToken', () => {
  it('reports the claims that identify which token arrived', () => {
    const token = encodeTokenWithClaims({
      iss: 'https://sts.windows.net/tenant/',
      aud: 'some-audience',
      ver: '1.0',
    });

    expect(describeUnverifiedToken(token)).toBe(
      'iss="https://sts.windows.net/tenant/" aud="some-audience" ver="1.0"',
    );
  });

  it('neutralizes claims crafted to forge a log entry', () => {
    const token = encodeTokenWithClaims({ iss: 'a\nb', aud: 'c\rd', ver: 2 });
    const described = describeUnverifiedToken(token);

    expect(described).not.toMatch(/[\n\r]/);
    expect(described).toBe('iss="a\\nb" aud="c\\rd" ver="2"');
  });

  it.each([['not-a-jwt'], [''], ['header..signature']])(
    'says the claims are unreadable for %j rather than throwing',
    (token) => {
      expect(describeUnverifiedToken(token)).toBe('claims=unreadable');
    },
  );
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

  it('answers 503, not 401, when the key set could not be reached', async () => {
    // Nothing is known about the token, so telling the operator to sign in again would send them
    // chasing their own session over an engine-side fault.
    verifier.verify = jest
      .fn()
      .mockRejectedValue(new AdminTokenVerifierUnavailableError('request timed out'));
    const guard = new AzureJwtGuard(createConfigService(true), verifier);
    const context = createContext({ headers: { authorization: 'Bearer valid.token' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not tell the caller why verification was unavailable', async () => {
    verifier.verify = jest
      .fn()
      .mockRejectedValue(new AdminTokenVerifierUnavailableError('connect ECONNREFUSED 10.0.0.1'));
    const guard = new AzureJwtGuard(createConfigService(true), verifier);
    const context = createContext({ headers: { authorization: 'Bearer valid.token' } });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Access token could not be verified right now',
    );
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
