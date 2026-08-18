/**
 * The SSO providers the panel can sign an operator in against, selected with `VITE_SSO_PROVIDER`.
 *
 * Only Microsoft Entra ID is implemented today. The switch exists so pointing a deployment at a
 * different directory — Google Workspace, say — is a configuration change plus that provider's
 * own client, rather than an edit scattered across the panel. Adding one means an entry here and
 * the client wiring behind it; everything else reads the provider from this module.
 */
export const SSO_PROVIDERS = {
  azure: { signInLabel: 'Sign in with Microsoft' },
} as const;

export type SsoProviderId = keyof typeof SSO_PROVIDERS;

/** Used when `VITE_SSO_PROVIDER` is unset, so an existing build keeps its behaviour. */
export const DEFAULT_SSO_PROVIDER: SsoProviderId = 'azure';

export interface AuthConfig {
  provider: SsoProviderId;
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
 * The configured SSO provider. An unsupported value is refused by name rather than silently
 * falling back to Entra, which would sign operators in against the wrong directory.
 */
export function readSsoProvider(): SsoProviderId {
  const configured = readValue(import.meta.env.VITE_SSO_PROVIDER)?.toLowerCase();

  if (configured === undefined) {
    return DEFAULT_SSO_PROVIDER;
  }

  if (!Object.hasOwn(SSO_PROVIDERS, configured)) {
    throw new Error(
      `VITE_SSO_PROVIDER='${configured}' is not a supported SSO provider (one of: ${Object.keys(
        SSO_PROVIDERS,
      ).join(', ')}).`,
    );
  }

  return configured as SsoProviderId;
}

/**
 * Reads the selected provider's configuration, failing loudly and naming the offending variable.
 * These are public identifiers, not secrets: the panel is a browser public client using PKCE, so
 * no client secret exists to leak. Entra is the only provider, so its settings are always the
 * ones required; a second provider would read its own here.
 */
export function readAuthConfig(): AuthConfig {
  return {
    provider: readSsoProvider(),
    clientId: requireValue('VITE_AZURE_CLIENT_ID', import.meta.env.VITE_AZURE_CLIENT_ID),
    tenantId: requireValue('VITE_AZURE_TENANT_ID', import.meta.env.VITE_AZURE_TENANT_ID),
    apiScope: requireValue('VITE_AZURE_API_SCOPE', import.meta.env.VITE_AZURE_API_SCOPE),
    redirectUri: readValue(import.meta.env.VITE_AZURE_REDIRECT_URI),
  };
}
