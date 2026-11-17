import { hasSuperadminRole } from '../domain/admin-permissions';

export enum EndpointGuardRefusal {
  TWO_FACTOR_REQUIRED = 'TWO_FACTOR_REQUIRED',
  LAST_SUPERADMIN = 'LAST_SUPERADMIN',
}

export interface EndpointGuardLookups {
  /** The signed-in user, or null when unauthenticated or server-side; read only for guarded paths. */
  findSessionUser(): Promise<EndpointGuardSessionUser | null>;
  hasCredentialAccount(userId: string): Promise<boolean>;
  findUser(userId: string): Promise<{ role: string | null; banned: boolean } | null>;
  /** Non-banned superadmins other than the given user. */
  countActiveSuperadminsExcept(userId: string): Promise<number>;
}

export interface EndpointGuardSessionUser {
  id: string;
  twoFactorEnabled?: boolean | null;
}

const TWO_FACTOR_GUARDED_PREFIXES = ['/admin/', '/organization/'];
/** The invitee opens these before they can have enrolled TOTP, so the rule cannot apply to them. */
const TWO_FACTOR_EXEMPT_PATHS = ['/organization/get-invitation', '/organization/accept-invitation'];
const SET_ROLE_PATH = '/admin/set-role';
const UPDATE_USER_PATH = '/admin/update-user';
const SUPERADMIN_LOSING_PATHS = [
  SET_ROLE_PATH,
  UPDATE_USER_PATH,
  '/admin/ban-user',
  '/admin/remove-user',
];

/**
 * The refusal better-auth's own `/admin/*` and `/organization/*` endpoints owe, or null to let the
 * request through. They never pass `AdminSessionGuard`, so this re-applies its 2FA rule (a user
 * with a credential account needs `twoFactorEnabled`; a Microsoft-only user is exempt) and keeps at
 * least one non-banned superadmin.
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
  const isTwoFactorGuarded =
    TWO_FACTOR_GUARDED_PREFIXES.some((prefix) => path.startsWith(prefix)) &&
    !TWO_FACTOR_EXEMPT_PATHS.includes(path);

  if (isTwoFactorGuarded) {
    const sessionUser = await lookups.findSessionUser();

    if (
      sessionUser &&
      sessionUser.twoFactorEnabled !== true &&
      (await lookups.hasCredentialAccount(sessionUser.id))
    ) {
      return EndpointGuardRefusal.TWO_FACTOR_REQUIRED;
    }
  }

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
