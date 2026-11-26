const ACCEPT_INVITATION_PATH = '/accept-invitation';

/** Where an invitation email may send its reader: the engine, and the panel when served apart from it. */
export interface InvitationLinkOrigins {
  /** `BETTER_AUTH_URL`: the engine, which serves the panel itself. */
  readonly engineUrl: string;
  /** `ADMIN_PANEL_ORIGIN`: a panel served from its own origin, such as `pnpm dev`. */
  readonly panelOrigin: string;
}

/**
 * The accept-invitation link for an invitation email. The inviter clicked Invite in the panel, so
 * their request's `Origin` is where the panel actually runs; the link goes there when that origin
 * is one the engine trusts. Anything else — no `Origin` (an invite sent server-side), or an origin
 * outside the two — falls back to the engine, which serves the panel itself. A forged `Origin`
 * can therefore never point an invitee at a foreign site.
 */
export function buildInvitationLink(
  invitationId: string,
  requestOrigin: string | null | undefined,
  { engineUrl, panelOrigin }: InvitationLinkOrigins,
): string {
  const engineBase = engineUrl.replace(/\/+$/, '');
  const base =
    requestOrigin === panelOrigin && requestOrigin !== new URL(engineBase).origin
      ? panelOrigin
      : engineBase;

  return `${base}${ACCEPT_INVITATION_PATH}/${encodeURIComponent(invitationId)}`;
}
