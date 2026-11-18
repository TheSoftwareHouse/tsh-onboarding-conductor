import { authClient } from '@/services/auth/auth-client';
import { unwrap } from '@/services/auth/unwrap-auth-result';

/** The platform roles of the admin plugin; `superadmin` bypasses the organization check. */
export const PLATFORM_ROLES = ['user', 'superadmin'] as const;
export const SUPERADMIN_ROLE = 'superadmin';
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export interface PlatformUserFilters {
  /** Matched against the email, anywhere in it. Empty lists everyone. */
  search: string;
  page: number;
  pageSize: number;
}

/** The users page the admin plugin returns, newest first. */
export async function fetchPlatformUsers({ search, page, pageSize }: PlatformUserFilters) {
  return unwrap(
    authClient.admin.listUsers({
      query: {
        ...(search
          ? { searchValue: search, searchField: 'email', searchOperator: 'contains' }
          : {}),
        limit: pageSize,
        offset: (page - 1) * pageSize,
        sortBy: 'createdAt',
        sortDirection: 'desc',
      },
    }),
    'Unable to load the users.',
  );
}

export type PlatformUser = Awaited<ReturnType<typeof fetchPlatformUsers>>['users'][number];

/** Never more than this many superadmins are read when counting the active ones. */
const SUPERADMIN_READ_LIMIT = 100;

/** Every user holding the `superadmin` role, banned or not. */
export async function fetchSuperadmins() {
  const { users } = await unwrap(
    authClient.admin.listUsers({
      query: {
        filterField: 'role',
        filterValue: SUPERADMIN_ROLE,
        filterOperator: 'eq',
        limit: SUPERADMIN_READ_LIMIT,
      },
    }),
    'Unable to load the superadmins.',
  );
  return users;
}

export function isSuperadmin(user: { role?: string | null }): boolean {
  return user.role?.split(',').includes(SUPERADMIN_ROLE) ?? false;
}

export async function setUserRole(userId: string, role: PlatformRole) {
  // The client's role union is the plugin default (`user` | `admin`); the engine declares `superadmin` too.
  const body = { userId, role } as Parameters<typeof authClient.admin.setRole>[0];
  const result = await unwrap(authClient.admin.setRole(body), 'Unable to change the role.');
  // The admin plugin refreshes no session on a role change, so an operator who changed their own
  // role would keep the old one in the panel (the platform links) until the next sign-in.
  authClient.$store.notify('$sessionSignal');
  return result;
}

export function banUser(userId: string) {
  return unwrap(authClient.admin.banUser({ userId }), 'Unable to ban the user.');
}

export function unbanUser(userId: string) {
  return unwrap(authClient.admin.unbanUser({ userId }), 'Unable to unban the user.');
}

export function revokeUserSessions(userId: string) {
  return unwrap(authClient.admin.revokeUserSessions({ userId }), 'Unable to revoke the sessions.');
}

export function setUserPassword(userId: string, newPassword: string) {
  return unwrap(
    authClient.admin.setUserPassword({ userId, newPassword }),
    'Unable to set the password.',
  );
}

export async function fetchPlatformOrganizations() {
  return unwrap(authClient.organization.list(), 'Unable to load the organizations.');
}

export type PlatformOrganization = Awaited<ReturnType<typeof fetchPlatformOrganizations>>[number];

/** better-auth wants a unique slug as well; the name, lower-cased and hyphenated, is enough for one. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The caller becomes the organization's owner, so a superadmin can invite into it straight away. */
export function createOrganization(name: string) {
  return unwrap(
    authClient.organization.create({ name, slug: slugify(name) }),
    'Unable to create the organization.',
  );
}
