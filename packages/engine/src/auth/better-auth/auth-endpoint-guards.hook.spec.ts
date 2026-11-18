import {
  EndpointGuardRefusal,
  findEndpointGuardRefusal,
  type EndpointGuardLookups,
} from './auth-endpoint-guards.hook';

const lookups = (overrides: Partial<EndpointGuardLookups> = {}): EndpointGuardLookups => ({
  findUser: jest.fn().mockResolvedValue({ role: 'superadmin', banned: false }),
  countActiveSuperadminsExcept: jest.fn().mockResolvedValue(0),
  ...overrides,
});

describe('findEndpointGuardRefusal', () => {
  describe('last superadmin', () => {
    it.each([
      ['/admin/set-role', { userId: 'u2', role: 'user' }],
      ['/admin/ban-user', { userId: 'u2' }],
      ['/admin/remove-user', { userId: 'u2' }],
    ])('refuses %s on the last superadmin', async (path, body) => {
      await expect(findEndpointGuardRefusal(path, body, lookups())).resolves.toBe(
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
          lookups({ countActiveSuperadminsExcept: jest.fn().mockResolvedValue(1) }),
        ),
      ).resolves.toBeNull();
    });

    it.each([
      ['demoting', { userId: 'u2', data: { role: 'user' } }],
      ['banning', { userId: 'u2', data: { banned: true } }],
    ])('refuses /admin/update-user %s the last superadmin', async (_label, body) => {
      await expect(findEndpointGuardRefusal('/admin/update-user', body, lookups())).resolves.toBe(
        EndpointGuardRefusal.LAST_SUPERADMIN,
      );
    });

    it.each([
      ['a name change', { userId: 'u2', data: { name: 'New' } }],
      ['keeping superadmin', { userId: 'u2', data: { role: 'user,superadmin' } }],
      ['unbanning', { userId: 'u2', data: { banned: false } }],
    ])('allows /admin/update-user %s', async (_label, body) => {
      const l = lookups();

      await expect(findEndpointGuardRefusal('/admin/update-user', body, l)).resolves.toBeNull();
      expect(l.findUser).not.toHaveBeenCalled();
    });

    it('allows a set-role that keeps superadmin', async () => {
      await expect(
        findEndpointGuardRefusal(
          '/admin/set-role',
          { userId: 'u2', role: ['superadmin', 'user'] },
          lookups(),
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
          lookups({ findUser: jest.fn().mockResolvedValue(user) }),
        ),
      ).resolves.toBeNull();
    });
  });
});
