import {
  ExecutionContext,
  ForbiddenException,
  Logger,
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
import type { AdminAccessAuditEvent, AdminAccessAuditPort } from './admin-access-audit.port';
import {
  AzureJwtGuard,
  describeUnverifiedToken,
  hasAnyRequiredRole,
  quoteForLog,
  readBearerToken,
  readEndpoint,
  readOperatorIdentity,
  readUnverifiedTokenDescriptor,
} from './azure-jwt.guard';

function encodeTokenWithClaims(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');

  return `header.${payload}.signature`;
}

type TestRequest = {
  headers: Record<string, string | undefined>;
  method?: string;
  path?: string;
  route?: { path?: string };
  adminTokenClaims?: JWTPayload;
};

function createContext(request: TestRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/**
 * Captures what the guard recorded. `record` resolves rather than doing work, so a spec asserts
 * on the event the guard built without a database in the picture.
 */
function createAccessAudit(): AdminAccessAuditPort & { events: AdminAccessAuditEvent[] } {
  const events: AdminAccessAuditEvent[] = [];

  return {
    events,
    record: jest.fn((event: AdminAccessAuditEvent) => {
      events.push(event);

      return Promise.resolve();
    }),
  };
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

describe('readEndpoint', () => {
  it('prefers the registered route pattern so parameterized routes aggregate', () => {
    expect(
      readEndpoint({
        headers: {},
        method: 'get',
        path: '/v1/onboardings/abc',
        route: { path: '/v1/onboardings/:id' },
      }),
    ).toEqual({ method: 'GET', path: '/v1/onboardings/:id' });
  });

  it('falls back to the concrete path when no route pattern is attached', () => {
    expect(readEndpoint({ headers: {}, method: 'GET', path: '/v1/admin/audit' })).toEqual({
      method: 'GET',
      path: '/v1/admin/audit',
    });
  });

  it('names the endpoint rather than throwing when the request carries neither', () => {
    expect(readEndpoint({ headers: {} })).toEqual({ method: 'UNKNOWN', path: 'unknown' });
  });

  it('clips an oversized path so one request cannot bloat the audit row', () => {
    const { path } = readEndpoint({ headers: {}, method: 'GET', path: `/${'a'.repeat(5000)}` });

    expect(path.length).toBeLessThan(250);
  });
});

describe('readOperatorIdentity', () => {
  it('keys the trail on the immutable object id and records the sign-in name beside it', () => {
    expect(
      readOperatorIdentity({
        oid: '9f3c0000-0000-0000-0000-00000000000a',
        sub: 'pairwise-subject',
        preferred_username: 'anna.kowalska@tsh.io',
        tid: '11111111-1111-1111-1111-111111111111',
        roles: ['admin', 'auditor'],
      }),
    ).toEqual({
      objectId: '9f3c0000-0000-0000-0000-00000000000a',
      userPrincipalName: 'anna.kowalska@tsh.io',
      tenantId: '11111111-1111-1111-1111-111111111111',
      roles: ['admin', 'auditor'],
    });
  });

  it('falls back to sub when the directory emits no oid', () => {
    expect(readOperatorIdentity({ sub: 'pairwise-subject' }).objectId).toBe('pairwise-subject');
  });

  it.each([
    ['preferred_username', { preferred_username: 'a@tsh.io' }],
    ['upn', { upn: 'a@tsh.io' }],
    ['email', { email: 'a@tsh.io' }],
  ])('reads the sign-in name from %s', (_label, claims) => {
    expect(readOperatorIdentity(claims).userPrincipalName).toBe('a@tsh.io');
  });

  it('records no identity fields at all rather than inventing them', () => {
    expect(readOperatorIdentity({})).toEqual({
      objectId: null,
      userPrincipalName: null,
      tenantId: null,
      roles: [],
    });
  });

  it.each([[42], [null], [{ oid: 'x' }], ['']])(
    'treats a non-string oid of %p as absent',
    (oid) => {
      expect(readOperatorIdentity({ oid, sub: undefined }).objectId).toBeNull();
    },
  );

  it('drops non-string entries from the roles claim', () => {
    expect(readOperatorIdentity({ roles: ['admin', 42, null, 'auditor'] }).roles).toEqual([
      'admin',
      'auditor',
    ]);
  });

  it('bounds an absurd roles claim so a crafted directory cannot grow the row without limit', () => {
    const claims = { roles: Array.from({ length: 500 }, (_, index) => `role-${index}`) };

    expect(readOperatorIdentity(claims).roles).toHaveLength(32);
  });

  it('clips an oversized claim value', () => {
    const identity = readOperatorIdentity({ oid: 'a'.repeat(5000), tid: 'b'.repeat(5000) });

    expect(identity.objectId!.length).toBeLessThan(250);
    expect(identity.tenantId!.length).toBeLessThan(250);
  });
});

describe('readUnverifiedTokenDescriptor', () => {
  it('reports the claims that identify which rejected token arrived', () => {
    const token = encodeTokenWithClaims({
      iss: 'https://sts.windows.net/tenant/',
      aud: 'some-audience',
      ver: '1.0',
    });

    expect(readUnverifiedTokenDescriptor(token)).toEqual({
      issuer: 'https://sts.windows.net/tenant/',
      audience: 'some-audience',
      version: '1.0',
    });
  });

  it('accepts the numeric ver a hand-rolled token can carry', () => {
    expect(readUnverifiedTokenDescriptor(encodeTokenWithClaims({ ver: 2 })).version).toBe('2');
  });

  it('reads the first string entry of a multi-valued aud, which the JWT spec permits', () => {
    const token = encodeTokenWithClaims({ aud: ['first-audience', 'second-audience'] });

    expect(readUnverifiedTokenDescriptor(token).audience).toBe('first-audience');
  });

  it.each([['not-a-jwt'], [''], ['header..signature']])(
    'records nothing for the unreadable token %j rather than throwing',
    (token) => {
      expect(readUnverifiedTokenDescriptor(token)).toEqual({
        issuer: null,
        audience: null,
        version: null,
      });
    },
  );

  it('clips oversized claims so a crafted token cannot bloat the audit row', () => {
    const token = encodeTokenWithClaims({ iss: 'https://evil/'.repeat(5000) });

    expect(readUnverifiedTokenDescriptor(token).issuer!.length).toBeLessThan(250);
  });
});

describe('AzureJwtGuard', () => {
  const claims: JWTPayload = {
    oid: '9f3c0000-0000-0000-0000-00000000000a',
    sub: 'operator-object-id',
    preferred_username: 'anna.kowalska@tsh.io',
    tid: '11111111-1111-1111-1111-111111111111',
    roles: ['admin'],
  };
  let verifier: AdminTokenVerifierPort;
  let accessAudit: ReturnType<typeof createAccessAudit>;

  function createGuard(
    adminAuthEnabled: boolean,
    requiredRoles = 'admin',
    tokenVerifier: AdminTokenVerifierPort | null = verifier,
  ): AzureJwtGuard {
    return new AzureJwtGuard(
      createConfigService(adminAuthEnabled, requiredRoles),
      tokenVerifier,
      accessAudit,
    );
  }

  function adminRequest(authorization?: string): TestRequest {
    return {
      headers: authorization === undefined ? {} : { authorization },
      method: 'GET',
      route: { path: '/v1/onboardings' },
    };
  }

  beforeEach(() => {
    verifier = { verify: jest.fn().mockResolvedValue(claims) };
    accessAudit = createAccessAudit();
  });

  it('allows a request carrying a verifiable token and exposes the claims', async () => {
    const guard = createGuard(true);
    const request = adminRequest('Bearer valid.token');

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(verifier.verify).toHaveBeenCalledWith('valid.token');
    expect(request.adminTokenClaims).toBe(claims);
  });

  it('rejects a request without an Authorization header', async () => {
    const guard = createGuard(true);

    await expect(guard.canActivate(createContext(adminRequest()))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('rejects a request whose token fails verification, as 401 rather than 500', async () => {
    verifier.verify = jest.fn().mockRejectedValue(new AdminTokenVerificationError('expired'));
    const guard = createGuard(true);

    await expect(
      guard.canActivate(createContext(adminRequest('Bearer expired.token'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not leak the verification failure detail to the caller', async () => {
    verifier.verify = jest
      .fn()
      .mockRejectedValue(new AdminTokenVerificationError('unexpected "iss" claim value'));
    const guard = createGuard(true);

    await expect(
      guard.canActivate(createContext(adminRequest('Bearer wrong.issuer'))),
    ).rejects.toThrow('Invalid access token');
  });

  it('answers 503, not 401, when the key set could not be reached', async () => {
    // Nothing is known about the token, so telling the operator to sign in again would send them
    // chasing their own session over an engine-side fault.
    verifier.verify = jest
      .fn()
      .mockRejectedValue(new AdminTokenVerifierUnavailableError('request timed out'));
    const guard = createGuard(true);

    await expect(
      guard.canActivate(createContext(adminRequest('Bearer valid.token'))),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not tell the caller why verification was unavailable', async () => {
    verifier.verify = jest
      .fn()
      .mockRejectedValue(new AdminTokenVerifierUnavailableError('connect ECONNREFUSED 10.0.0.1'));
    const guard = createGuard(true);

    await expect(
      guard.canActivate(createContext(adminRequest('Bearer valid.token'))),
    ).rejects.toThrow('Access token could not be verified right now');
  });

  it('answers 403, not 401, when the token carries no assigned role', async () => {
    verifier.verify = jest.fn().mockResolvedValue({ sub: 'operator-object-id' });
    const guard = createGuard(true);

    await expect(
      guard.canActivate(createContext(adminRequest('Bearer valid.token'))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 403 when the token carries only roles outside the allowlist', async () => {
    verifier.verify = jest.fn().mockResolvedValue({ sub: 'x', roles: ['auditor', 'compliance'] });
    const guard = createGuard(true, 'admin');

    await expect(
      guard.canActivate(createContext(adminRequest('Bearer valid.token'))),
    ).rejects.toThrow(/one of: admin/);
  });

  it('allows a role named anywhere in a multi-role allowlist', async () => {
    verifier.verify = jest.fn().mockResolvedValue({ sub: 'x', roles: ['auditor'] });
    const guard = createGuard(true, 'admin,auditor');

    await expect(
      guard.canActivate(createContext(adminRequest('Bearer valid.token'))),
    ).resolves.toBe(true);
  });

  it('allows every request when admin auth is disabled', async () => {
    const guard = createGuard(false, 'admin', null);

    await expect(guard.canActivate(createContext(adminRequest()))).resolves.toBe(true);
  });

  describe('audit trail', () => {
    it('records a successful read against the operator who made it', async () => {
      const guard = createGuard(true);

      await guard.canActivate(createContext(adminRequest('Bearer valid.token')));

      expect(accessAudit.events).toEqual([
        {
          outcome: 'granted',
          endpoint: { method: 'GET', path: '/v1/onboardings' },
          operator: {
            objectId: '9f3c0000-0000-0000-0000-00000000000a',
            userPrincipalName: 'anna.kowalska@tsh.io',
            tenantId: '11111111-1111-1111-1111-111111111111',
            roles: ['admin'],
          },
        },
      ]);
    });

    it('records a missing credential without inventing a token to describe', async () => {
      const guard = createGuard(true);

      await expect(guard.canActivate(createContext(adminRequest()))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(accessAudit.events).toEqual([
        {
          outcome: 'token_rejected',
          endpoint: { method: 'GET', path: '/v1/onboardings' },
          reason: 'Missing bearer access token',
          token: { issuer: null, audience: null, version: null },
        },
      ]);
    });

    it('records a rejected token with the reason and the claims it carried', async () => {
      verifier.verify = jest
        .fn()
        .mockRejectedValue(new AdminTokenVerificationError('unexpected "iss" claim value'));
      const token = encodeTokenWithClaims({
        iss: 'https://sts.windows.net/other-tenant/',
        aud: 'some-audience',
        ver: '1.0',
      });
      const guard = createGuard(true);

      await expect(
        guard.canActivate(createContext(adminRequest(`Bearer ${token}`))),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(accessAudit.events).toEqual([
        {
          outcome: 'token_rejected',
          endpoint: { method: 'GET', path: '/v1/onboardings' },
          reason: 'unexpected "iss" claim value',
          token: {
            issuer: 'https://sts.windows.net/other-tenant/',
            audience: 'some-audience',
            version: '1.0',
          },
        },
      ]);
    });

    it('records a role refusal against the named operator, with what was required', async () => {
      verifier.verify = jest.fn().mockResolvedValue({
        oid: 'operator-oid',
        preferred_username: 'bob@tsh.io',
        tid: 'tenant-id',
        roles: ['auditor'],
      });
      const guard = createGuard(true, 'admin,compliance');

      await expect(
        guard.canActivate(createContext(adminRequest('Bearer valid.token'))),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(accessAudit.events).toEqual([
        {
          outcome: 'role_missing',
          endpoint: { method: 'GET', path: '/v1/onboardings' },
          operator: {
            objectId: 'operator-oid',
            userPrincipalName: 'bob@tsh.io',
            tenantId: 'tenant-id',
            roles: ['auditor'],
          },
          requiredRoles: ['admin', 'compliance'],
        },
      ]);
    });

    it('records an unreachable key set as its own outcome, not as a rejected credential', async () => {
      verifier.verify = jest
        .fn()
        .mockRejectedValue(new AdminTokenVerifierUnavailableError('request timed out'));
      const guard = createGuard(true);

      await expect(
        guard.canActivate(createContext(adminRequest('Bearer valid.token'))),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(accessAudit.events).toEqual([
        {
          outcome: 'verification_unavailable',
          endpoint: { method: 'GET', path: '/v1/onboardings' },
          reason: 'request timed out',
        },
      ]);
    });

    it('records the read even when the escape hatch served it with no credential at all', async () => {
      // The one case with no identity to attribute, and the one most worth knowing about.
      const guard = createGuard(false, 'admin', null);

      await expect(guard.canActivate(createContext(adminRequest()))).resolves.toBe(true);
      expect(accessAudit.events).toEqual([
        { outcome: 'unauthenticated', endpoint: { method: 'GET', path: '/v1/onboardings' } },
      ]);
    });

    it('serves the request anyway when the audit row cannot be written', async () => {
      // Best effort by design: a database outage must not take the admin endpoints down with it.
      accessAudit.record = jest.fn().mockRejectedValue(new Error('connection terminated'));
      const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const guard = createGuard(true);

      try {
        await expect(
          guard.canActivate(createContext(adminRequest('Bearer valid.token'))),
        ).resolves.toBe(true);
        await Promise.resolve();

        expect(errorLog).toHaveBeenCalledWith(
          expect.stringContaining('AUTH_AUDIT_WRITE_FAILED outcome=granted'),
        );
      } finally {
        errorLog.mockRestore();
      }
    });

    it('still refuses the request when the audit row for a refusal cannot be written', async () => {
      accessAudit.record = jest.fn().mockRejectedValue(new Error('connection terminated'));
      const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const guard = createGuard(true);

      try {
        await expect(guard.canActivate(createContext(adminRequest()))).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      } finally {
        errorLog.mockRestore();
      }
    });

    it('records exactly one event per request', async () => {
      const guard = createGuard(true);

      await guard.canActivate(createContext(adminRequest('Bearer valid.token')));

      expect(accessAudit.record).toHaveBeenCalledTimes(1);
    });
  });
});
