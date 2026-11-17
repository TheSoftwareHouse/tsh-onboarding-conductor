import {
  ADMIN_PERMISSION_STATEMENTS,
  ORGANIZATION_ROLE_PERMISSIONS,
  SUPERADMIN_PERMISSIONS,
  hasSuperadminRole,
} from './admin-permissions';

describe('admin permissions', () => {
  const allPermissions = Object.entries(ADMIN_PERMISSION_STATEMENTS).flatMap(
    ([resource, actions]) => actions.map((action) => `${resource}:${action}`),
  );
  const held = (role: keyof typeof ORGANIZATION_ROLE_PERMISSIONS) =>
    Object.entries(ORGANIZATION_ROLE_PERMISSIONS[role]).flatMap(([resource, actions]) =>
      actions.map((action) => `${resource}:${action}`),
    );

  it('grants member exactly every read plus onboarding:review', () => {
    const expected = allPermissions.filter(
      (permission) => permission.endsWith(':read') || permission === 'onboarding:review',
    );

    expect(held('member').sort()).toEqual(expected.sort());
  });

  it('withholds agreement:write from member', () => {
    expect(held('member')).toContain('agreement:read');
    expect(held('member')).not.toContain('agreement:write');
  });

  it.each(['owner', 'admin'] as const)('grants %s every permission', (role) => {
    expect(held(role).sort()).toEqual([...allPermissions].sort());
  });

  it('keeps impersonation out of the superadmin grants', () => {
    expect(SUPERADMIN_PERMISSIONS.user).not.toContain('impersonate');
  });

  it('keeps user:update out of the superadmin grants, so /admin/update-user is refused', () => {
    expect(SUPERADMIN_PERMISSIONS.user).not.toContain('update');
  });

  it.each([
    ['superadmin', true],
    ['user,superadmin', true],
    [['user', 'superadmin'], true],
    ['user', false],
    ['superadmins', false],
    [null, false],
    [undefined, false],
  ])('hasSuperadminRole(%j) is %s', (role, expected) => {
    expect(hasSuperadminRole(role)).toBe(expected);
  });
});
