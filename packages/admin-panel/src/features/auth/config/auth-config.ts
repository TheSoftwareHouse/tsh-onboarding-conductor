export interface AuthConfig {
  clientId: string;
  tenantId: string;
  apiScope: string;
  /** Undefined means "use the origin the panel is served from", which is MSAL's default. */
  redirectUri?: string;
}

function readValue(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
}

function requireValue(name: string, value: string | undefined): string {
  const resolved = readValue(value);

  if (!resolved) {
    throw new Error(
      `${name} is required while sign-in is enabled. Set it or set VITE_AUTH_ENABLED=false.`,
    );
  }

  return resolved;
}

/**
 * Sign-in is on unless it is explicitly switched off, so a build that forgets to configure the
 * flag is gated rather than open.
 */
export function isAuthEnabled(): boolean {
  return readValue(import.meta.env.VITE_AUTH_ENABLED)?.toLowerCase() !== 'false';
}

/**
 * Reads the Entra ID configuration, failing loudly and naming the offending variable. These are
 * public identifiers, not secrets: the panel is a browser public client using PKCE, so no client
 * secret exists to leak.
 */
export function readAuthConfig(): AuthConfig {
  return {
    clientId: requireValue('VITE_AZURE_CLIENT_ID', import.meta.env.VITE_AZURE_CLIENT_ID),
    tenantId: requireValue('VITE_AZURE_TENANT_ID', import.meta.env.VITE_AZURE_TENANT_ID),
    apiScope: requireValue('VITE_AZURE_API_SCOPE', import.meta.env.VITE_AZURE_API_SCOPE),
    redirectUri: readValue(import.meta.env.VITE_AZURE_REDIRECT_URI),
  };
}
