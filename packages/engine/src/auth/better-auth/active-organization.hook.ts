export interface ActiveOrganizationLookups {
  /** The organization of the user's oldest `member` row, or null when they have none. */
  findFirstOrganizationId(userId: string): Promise<string | null>;
}

/**
 * The `activeOrganizationId` a new session should carry, or null to leave it as it is. Called from
 * `databaseHooks.session.create.before`; without it a single-organization member has no active
 * organization and every admin route answers 403.
 */
export async function findActiveOrganizationId(
  session: { userId: string; activeOrganizationId?: string | null },
  lookups: ActiveOrganizationLookups,
): Promise<string | null> {
  if (session.activeOrganizationId) {
    return null;
  }

  return lookups.findFirstOrganizationId(session.userId);
}
