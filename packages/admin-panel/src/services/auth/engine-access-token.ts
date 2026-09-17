import { InteractionRequiredAuthError } from '@azure/msal-browser';
import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser';
import { isAuthEnabled, readAuthConfig } from './auth-config';
import { getMsalInstance } from './msal-instance';

/**
 * The redirect currently being started, if any.
 *
 * MSAL refuses a second interactive request while one is in flight, and rejects it with
 * `interaction_in_progress` rather than an `InteractionRequiredAuthError` — which would escape
 * this module and reach the operator as a raw MSAL string. Requests are not serialized, so more
 * than one can find the cache empty at the same time; they share the first redirect instead.
 */
let pendingRedirect: Promise<void> | null = null;

function startInteractiveRedirect(
  instance: PublicClientApplication,
  account: AccountInfo,
  scopes: string[],
): Promise<void> {
  pendingRedirect ??= instance.acquireTokenRedirect({ account, scopes }).catch((cause: unknown) => {
    // The redirect never left, so the page is still here and a later attempt should be free to
    // try again rather than await a promise that already failed.
    pendingRedirect = null;

    throw cause;
  });

  return pendingRedirect;
}

/** Test seam: drops the memoized redirect so a spec can observe a fresh one being started. */
export function resetPendingRedirect(): void {
  pendingRedirect = null;
}

/**
 * Returns an Entra ID access token for the engine's exposed API scope, or `null` when sign-in is
 * disabled or no account is signed in yet.
 *
 * The silent path is served from MSAL's cache and its own refresh handling. When Entra decides
 * the user must interact again — consent changed, session expired, MFA required — the only way
 * forward is a redirect, so this starts one and returns `null`; the in-flight request fails and
 * the page is replaced by the Entra sign-in screen.
 */
export async function acquireEngineAccessToken(): Promise<string | null> {
  if (!isAuthEnabled()) {
    return null;
  }

  const { apiScope } = readAuthConfig();
  const instance = getMsalInstance();
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];

  if (!account) {
    return null;
  }

  try {
    const result = await instance.acquireTokenSilent({ account, scopes: [apiScope] });

    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      await startInteractiveRedirect(instance, account, [apiScope]);

      return null;
    }

    throw error;
  }
}
