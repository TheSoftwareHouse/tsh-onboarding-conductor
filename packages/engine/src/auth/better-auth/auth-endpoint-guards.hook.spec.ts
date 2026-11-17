import {
  EndpointGuardRefusal,
  findEndpointGuardRefusal,
  type EndpointGuardLookups,
} from './auth-endpoint-guards.hook';

const credentialUserWithoutTotp = { id: 'u1', twoFactorEnabled: false };
const totpUser = { id: 'admin', twoFactorEnabled: true };

const lookups = (overrides: Partial<EndpointGuardLookups> = {}): EndpointGuardLookups => ({
  findSessionUser: jest.fn().mockResolvedValue(credentialUserWithoutTotp),
  hasCredentialAccount: jest.fn().mockResolvedValue(true),
  findUser: jest.fn().mockResolvedValue({ role: 'superadmin', banned: false }),
  countActiveSuperadminsExcept: jest.fn().mockResolvedValue(0),
  ...overrides,
});

describe('findEndpointGuardRefusal', () => {
  describe('two-factor rule', () => {
    it.each(['/admin/list-users', '/organization/invite-member'])(
      'refuses a credential user without TOTP on %s',
      async (path) => {
        await expect(findEndpointGuardRefusal(path, undefined, lookups())).resolves.toBe(
          EndpointGuardRefusal.TWO_FACTOR_REQUIRED,
        );
      },
    );

    it.each(['/organization/get-invitation', '/organization/accept-invitation'])(
      'exempts %s',
      async (path) => {
        await expect(findEndpointGuardRefusal(path, undefined, lookups())).resolves.toBeNull();
      },
    );

    it('exempts a Microsoft-only user', async () => {
      await expect(
        findEndpointGuardRefusal(
          '/admin/list-users',
          undefined,
          lookups({ hasCredentialAccount: jest.fn().mockResolvedValue(false) }),
        ),
      ).resolves.toBeNull();
    });

    it('lets a user with TOTP through without a credential lookup', async () => {
      const l = lookups({ findSessionUser: jest.fn().mockResolvedValue(totpUser) });

      await expect(findEndpointGuardRefusal('/admin/list-users', undefined, l)).resolves.toBeNull();
      expect(l.hasCredentialAccount).not.toHaveBeenCalled();
    });

    it('does not apply to an unauthenticated or server-side call', async () => {
      await expect(
        findEndpointGuardRefusal(
          '/admin/list-users',
          undefined,
          lookups({ findSessionUser: jest.fn().mockResolvedValue(null) }),
        ),
      ).resolves.toBeNull();
    });

    it('does not read the session for other paths', async () => {
      const l = lookups();

      await expect(findEndpointGuardRefusal('/sign-in/email', undefined, l)).resolves.toBeNull();
      expect(l.findSessionUser).not.toHaveBeenCalled();
    });
  });

  describe('last superadmin', () => {
    const withTotp = (overrides: Partial<EndpointGuardLookups> = {}) =>
      lookups({ findSessionUser: jest.fn().mockResolvedValue(totpUser), ...overrides });

    it.each([
      ['/admin/set-role', { userId: 'u2', role: 'user' }],
      ['/admin/ban-user', { userId: 'u2' }],
      ['/admin/remove-user', { userId: 'u2' }],
    ])('refuses %s on the last superadmin', async (path, body) => {
      await expect(findEndpointGuardRefusal(path, body, withTotp())).resolves.toBe(
        EndpointGuardRefusal.LAST_SUPERADMIN,
      );
    });

    it.each([
      ['/admin/set-role', { userId: 'u2', role: 'user' }],
      ['/admin/ban-user', { userId: 'u2' }],
      ['/admin/remove-user', { userId: 'u2' }],
    ])('allows %s when another superadmin remains', async (path, body) => {
      await expect(
        findEndpointGuardRefusal(
          path,
          body,
          withTotp({ countActiveSuperadminsExcept: jest.fn().mockResolvedValue(1) }),
        ),
      ).resolves.toBeNull();
    });

    it.each([
      ['demoting', { userId: 'u2', data: { role: 'user' } }],
      ['banning', { userId: 'u2', data: { banned: true } }],
    ])('refuses /admin/update-user %s the last superadmin', async (_label, body) => {
      await expect(findEndpointGuardRefusal('/admin/update-user', body, withTotp())).resolves.toBe(
        EndpointGuardRefusal.LAST_SUPERADMIN,
      );
    });

    it.each([
      ['a name change', { userId: 'u2', data: { name: 'New' } }],
      ['keeping superadmin', { userId: 'u2', data: { role: 'user,superadmin' } }],
      ['unbanning', { userId: 'u2', data: { banned: false } }],
    ])('allows /admin/update-user %s', async (_label, body) => {
      const l = withTotp();

      await expect(findEndpointGuardRefusal('/admin/update-user', body, l)).resolves.toBeNull();
      expect(l.findUser).not.toHaveBeenCalled();
    });

    it('allows a set-role that keeps superadmin', async () => {
      await expect(
        findEndpointGuardRefusal(
          '/admin/set-role',
          { userId: 'u2', role: ['superadmin', 'user'] },
          withTotp(),
        ),
      ).resolves.toBeNull();
    });

    it.each([
      ['a user who is not a superadmin', { role: 'user', banned: false }],
      ['an already banned superadmin', { role: 'superadmin', banned: true }],
      ['an unknown user', null],
    ])('allows touching %s', async (_label, user) => {
      await expect(
        findEndpointGuardRefusal(
          '/admin/ban-user',
          { userId: 'u2' },
          withTotp({ findUser: jest.fn().mockResolvedValue(user) }),
        ),
      ).resolves.toBeNull();
    });
  });
});
