import { createHash } from 'node:crypto';
import {
  ConfidentialClientApplication,
  InteractionRequiredAuthError,
  type IConfidentialClientApplication,
} from '@azure/msal-node';
import { MILLISECONDS_PER_MINUTE } from '../time.constants';
import { AuthUnavailableError, TokenRejectedError } from './auth.errors';
import { buildEntraAuthority } from './entra';

/** A cached engine token is replaced this long before it expires, so it never dies in flight. */
const EXPIRY_MARGIN_MS = MILLISECONDS_PER_MINUTE;

export interface OnBehalfOfOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** The scope requested for the engine, for example `api://<engine-app>/.default`. */
  engineScope: string;
  /** MSAL seam; the confidential client for the MCP app registration by default. */
  client?: Pick<IConfidentialClientApplication, 'acquireTokenOnBehalfOf'>;
}

interface CachedEngineToken {
  token: string;
  expiresAt: number;
}

/**
 * Exchanges the analyst's incoming access token for an engine access token on their behalf, so the
 * engine sees the analyst's own roles. A result is cached under a hash of the incoming token until
 * it expires: two analysts never share an entry, and the raw token is never held as a key.
 */
export class OnBehalfOfExchanger {
  private readonly engineScope: string;
  private readonly client: Pick<IConfidentialClientApplication, 'acquireTokenOnBehalfOf'>;
  private readonly cache = new Map<string, CachedEngineToken>();

  constructor({ tenantId, clientId, clientSecret, engineScope, client }: OnBehalfOfOptions) {
    this.engineScope = engineScope;
    this.client =
      client ??
      new ConfidentialClientApplication({
        auth: { clientId, clientSecret, authority: buildEntraAuthority(tenantId) },
      });
  }

  async exchange(incomingToken: string): Promise<string> {
    const key = createHash('sha256').update(incomingToken).digest('hex');
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return cached.token;
    }

    const engineToken = await this.acquire(incomingToken);
    this.evictExpired();
    this.cache.set(key, engineToken);

    return engineToken.token;
  }

  private async acquire(incomingToken: string): Promise<CachedEngineToken> {
    try {
      const result = await this.client.acquireTokenOnBehalfOf({
        oboAssertion: incomingToken,
        scopes: [this.engineScope],
      });

      if (!result?.expiresOn) {
        throw new AuthUnavailableError('Entra returned no engine token');
      }

      return { token: result.accessToken, expiresAt: result.expiresOn.getTime() };
    } catch (error) {
      if (error instanceof AuthUnavailableError) {
        throw error;
      }

      // Consent or a conditional-access step is still owed: signing in again can resolve it. Any
      // other failure — network, bad app credentials — is not the caller's to fix.
      if (error instanceof InteractionRequiredAuthError) {
        throw new TokenRejectedError(error.message);
      }

      throw new AuthUnavailableError(
        error instanceof Error ? error.message : 'On-behalf-of exchange failed',
      );
    }
  }

  /** Bounds the cache to the analysts with a live token rather than every token ever seen. */
  private evictExpired(): void {
    const now = Date.now();

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}
