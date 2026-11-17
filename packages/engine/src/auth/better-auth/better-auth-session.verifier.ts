import type { IncomingHttpHeaders } from 'node:http';
import type { Pool } from 'pg';
import {
  AdminSessionVerifierUnavailableError,
  type AdminSession,
  type AdminSessionVerifierPort,
} from '../admin-session-verifier.port';
import type { AdminPermission } from '../domain/admin-permissions';
import { loadBetterAuth, type BetterAuthInstance } from './load-better-auth';

/** `account.providerId` of an email + password account; a social (Microsoft) account has its own. */
const CREDENTIAL_PROVIDER_ID = 'credential';

/** The slice of the instance's `api` this adapter calls; the plugin endpoints are not in the base type. */
type SessionApi = {
  getSession(input: { headers: Headers }): Promise<{
    user: { id: string; email: string; role?: string | null; twoFactorEnabled?: boolean | null };
    session: { activeOrganizationId?: string | null };
  } | null>;
  hasPermission(input: {
    headers: Headers;
    body: { permissions: Record<string, string[]> };
  }): Promise<{ success: boolean }>;
};

/** Whether the user signs in with a password, which is what makes the 2FA rule apply to them. */
export async function hasCredentialAccount(pool: Pool, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM "account" WHERE "userId" = $1 AND "providerId" = $2 LIMIT 1',
    [userId, CREDENTIAL_PROVIDER_ID],
  );

  return rowCount > 0;
}

/** better-auth's `APIError` carries the HTTP status of a refusal; a store failure has none. */
function isClientRefusal(error: unknown): boolean {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;

  return typeof status === 'number' && status < 500;
}

function toUnavailable(error: unknown): AdminSessionVerifierUnavailableError {
  return new AdminSessionVerifierUnavailableError(
    error instanceof Error ? error.message : 'unknown',
  );
}

/** Reads sessions and organization permissions through the better-auth instance. */
export class BetterAuthSessionVerifier implements AdminSessionVerifierPort {
  constructor(
    private readonly auth: BetterAuthInstance,
    private readonly pool: Pool,
  ) {}

  async resolve(headers: IncomingHttpHeaders): Promise<AdminSession | null> {
    try {
      const { fromNodeHeaders } = await loadBetterAuth();
      const result = await this.api.getSession({ headers: fromNodeHeaders(headers) });

      if (!result) {
        return null;
      }

      const { user, session } = result;

      return {
        userId: user.id,
        email: user.email,
        platformRole: user.role ?? null,
        // 2FA rule: a credential user must have TOTP; a user with no credential account (Microsoft
        // only) is exempt because the tenant's Conditional Access enforces MFA.
        twoFactorSatisfied:
          user.twoFactorEnabled === true || !(await hasCredentialAccount(this.pool, user.id)),
        activeOrganizationId: session.activeOrganizationId ?? null,
      };
    } catch (error) {
      throw toUnavailable(error);
    }
  }

  async hasPermission(headers: IncomingHttpHeaders, permission: AdminPermission): Promise<boolean> {
    try {
      const { fromNodeHeaders } = await loadBetterAuth();
      const result = await this.api.hasPermission({
        headers: fromNodeHeaders(headers),
        body: { permissions: { [permission.resource]: [permission.action] } },
      });

      return result.success === true;
    } catch (error) {
      // Not a member of the active organization, or no active one: a refusal, not an outage.
      if (isClientRefusal(error)) {
        return false;
      }

      throw toUnavailable(error);
    }
  }

  private get api(): SessionApi {
    return this.auth.api as unknown as SessionApi;
  }
}
