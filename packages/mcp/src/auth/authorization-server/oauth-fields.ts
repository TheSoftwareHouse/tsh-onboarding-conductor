export const OFFLINE_ACCESS_SCOPE = 'offline_access';

export const GRANT_TYPE_AUTHORIZATION_CODE = 'authorization_code';
export const GRANT_TYPE_REFRESH_TOKEN = 'refresh_token';
export const SUPPORTED_GRANT_TYPES = [GRANT_TYPE_AUTHORIZATION_CODE, GRANT_TYPE_REFRESH_TOKEN];

export const RESPONSE_TYPE_CODE = 'code';
export const SUPPORTED_RESPONSE_TYPES = [RESPONSE_TYPE_CODE];

export const CODE_CHALLENGE_METHOD_S256 = 'S256';

/** Public clients (PKCE, no secret): the only kind the relay serves. */
export const TOKEN_ENDPOINT_AUTH_METHOD_NONE = 'none';

/**
 * The named parameters of a query or form body that are plain strings, and nothing else: a
 * repeated or nested parameter is dropped, and so is every name not listed. This is what keeps the
 * relay a whitelist — `resource` and anything a client invents never reaches Entra.
 */
export function pickStringFields(source: unknown, names: readonly string[]): Map<string, string> {
  const fields = new Map<string, string>();

  if (typeof source !== 'object' || source === null) {
    return fields;
  }

  for (const name of names) {
    const value = (source as Record<string, unknown>)[name];

    if (typeof value === 'string') {
      fields.set(name, value);
    }
  }

  return fields;
}

/** Entra issues a refresh token only when `offline_access` is among the scopes asked for. */
export function withOfflineAccess(scope: string): string {
  const scopes = scope.split(' ').filter((entry) => entry !== '');

  return scopes.includes(OFFLINE_ACCESS_SCOPE)
    ? scopes.join(' ')
    : [...scopes, OFFLINE_ACCESS_SCOPE].join(' ');
}
