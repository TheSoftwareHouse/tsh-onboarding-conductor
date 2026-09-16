import { PublicClientApplication } from '@azure/msal-browser';
import { readAuthConfig } from './auth-config';

const ENTRA_AUTHORITY_HOST = 'https://login.microsoftonline.com';

let instance: PublicClientApplication | null = null;

/**
 * The single MSAL client for the panel, created on first use so a build with sign-in disabled
 * never touches the Entra configuration.
 *
 * MSAL's SPA flow is the OAuth 2.0 authorization code flow with PKCE: it generates the code
 * verifier and S256 challenge, completes the redirect, caches the tokens, and renews them
 * silently. None of that is reimplemented here, and no client secret is involved.
 */
export function getMsalInstance(): PublicClientApplication {
  if (!instance) {
    const config = readAuthConfig();

    instance = new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `${ENTRA_AUTHORITY_HOST}/${config.tenantId}`,
        redirectUri: config.redirectUri ?? window.location.origin,
      },
      cache: {
        // Tokens die with the tab rather than persisting on disk.
        cacheLocation: 'sessionStorage',
      },
    });
  }

  return instance;
}

/** Test seam: drops the memoized client so a spec can build a fresh one. */
export function resetMsalInstance(): void {
  instance = null;
}
