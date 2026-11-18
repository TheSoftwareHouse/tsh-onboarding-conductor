import { hasSuperadminRole } from '../domain/admin-permissions';

export enum EndpointGuardRefusal {
  LAST_SUPERADMIN = 'LAST_SUPERADMIN',
}

export interface EndpointGuardLookups {
  findUser(userId: string): Promise<{ role: string | null; banned: boolean } | null>;
  /** Non-banned superadmins other than the given user. */
  countActiveSuperadminsExcept(userId: string): Promise<number>;
}

const SET_ROLE_PATH = '/admin/set-role';
const UPDATE_USER_PATH = '/admin/update-user';
const SUPERADMIN_LOSING_PATHS = [
  SET_ROLE_PATH,
  UPDATE_USER_PATH,
  '/admin/ban-user',
  '/admin/remove-user',
];

/**
 * The refusal better-auth's own `/admin/*` endpoints owe, or null to let the request through. They
 * never pass `AdminSessionGuard`, so this keeps at least one non-banned superadmin.
 */
export async function findEndpointGuardRefusal(
  path: string,
  body:
    | {
        userId?: string;
        role?: string | string[];
        data?: { role?: string | string[]; banned?: boolean; name?: string };
      }
    | undefined,
  lookups: EndpointGuardLookups,
): Promise<EndpointGuardRefusal | null> {
  if (!SUPERADMIN_LOSING_PATHS.includes(path) || !body?.userId) {
    return null;
  }

  if (path === SET_ROLE_PATH && hasSuperadminRole(body.role)) {
    return null;
  }

  if (path === UPDATE_USER_PATH) {
    const keepsSuperadmin =
      !body.data || !('role' in body.data) || hasSuperadminRole(body.data.role);

    // Only a role change away from superadmin or a ban can remove one.
    if (keepsSuperadmin && body.data?.banned !== true) {
      return null;
    }
  }

  const target = await lookups.findUser(body.userId);

  if (!target || target.banned || !hasSuperadminRole(target.role)) {
    return null;
  }

  return (await lookups.countActiveSuperadminsExcept(body.userId)) === 0
    ? EndpointGuardRefusal.LAST_SUPERADMIN
    : null;
}
