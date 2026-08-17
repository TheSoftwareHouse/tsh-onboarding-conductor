import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { isAuthEnabled, readAuthConfig } from './config/auth-config';
import { getMsalInstance } from './msal-instance';

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
      await instance.acquireTokenRedirect({ account, scopes: [apiScope] });

      return null;
    }

    throw error;
  }
}
