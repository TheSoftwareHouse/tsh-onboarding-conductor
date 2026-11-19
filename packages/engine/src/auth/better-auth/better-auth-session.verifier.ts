import type { IncomingHttpHeaders } from 'node:http';
import {
  AdminSessionVerifierUnavailableError,
  type AdminSession,
  type AdminSessionVerifierPort,
} from '../admin-session-verifier.port';
import type { AdminPermission } from '../domain/admin-permissions';
import { loadBetterAuth, type BetterAuthInstance } from './load-better-auth';

/** The slice of the instance's `api` this adapter calls; the plugin endpoints are not in the base type. */
type SessionApi = {
  getSession(input: { headers: Headers }): Promise<{
    user: { id: string; email: string; role?: string | null };
    session: { activeOrganizationId?: string | null };
  } | null>;
  hasPermission(input: {
    headers: Headers;
    body: { permissions: Record<string, string[]> };
  }): Promise<{ success: boolean }>;
};

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
  constructor(private readonly auth: BetterAuthInstance) {}

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
