/** Plain data shared by `@AdminRoute(...)` and the organization plugin's access control. */
export const ADMIN_PERMISSION_STATEMENTS = {
  onboarding: ['read', 'review', 'export'],
  workflow: ['read', 'write', 'publish'],
  connector: ['read', 'write'],
  encryption: ['read', 'write'],
  audit: ['read'],
  agreement: ['read', 'write'],
} as const;

export type AdminResource = keyof typeof ADMIN_PERMISSION_STATEMENTS;
export type AdminPermission = {
  [R in AdminResource]: { resource: R; action: (typeof ADMIN_PERMISSION_STATEMENTS)[R][number] };
}[AdminResource];

type AdminStatements = {
  [R in AdminResource]: readonly (typeof ADMIN_PERMISSION_STATEMENTS)[R][number][];
};

const READ_ACTION = 'read';
const REVIEW_ACTION = 'review';

/** Engine statements each organization role holds, on top of the library's own organization grants. */
export const ORGANIZATION_ROLE_PERMISSIONS: Record<'owner' | 'admin' | 'member', AdminStatements> =
  {
    owner: ADMIN_PERMISSION_STATEMENTS,
    admin: ADMIN_PERMISSION_STATEMENTS,
    member: Object.fromEntries(
      Object.entries(ADMIN_PERMISSION_STATEMENTS).map(([resource, actions]) => [
        resource,
        (actions as readonly string[]).filter(
          (action) =>
            action === READ_ACTION || (resource === 'onboarding' && action === REVIEW_ACTION),
        ),
      ]),
    ) as unknown as AdminStatements,
  };

/**
 * The admin plugin's user-management statements; `impersonate` is deliberately absent, and so is
 * `update`: `/admin/update-user` would let `data.role` / `data.banned` bypass the last-superadmin guard.
 */
export const SUPERADMIN_PERMISSIONS = {
  user: ['create', 'list', 'set-role', 'ban', 'delete', 'set-password', 'get'],
  session: ['list', 'revoke', 'delete'],
} as const;

export const SUPERADMIN_ROLE = 'superadmin';

/** better-auth stores several roles as one comma-separated string (`user,superadmin`). */
export const hasSuperadminRole = (role: string | string[] | null | undefined): boolean =>
  (Array.isArray(role) ? role : (role ?? '').split(',')).includes(SUPERADMIN_ROLE);
