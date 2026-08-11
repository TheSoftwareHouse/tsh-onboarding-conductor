export type HttpConnectorSecrets = Readonly<Record<string, Readonly<Record<string, string>>>>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseHttpConnectorSecrets(raw: string | undefined): HttpConnectorSecrets {
  const trimmed = raw?.trim() ?? '';

  if (trimmed.length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('HTTP_CONNECTOR_SECRETS must be valid JSON');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('HTTP_CONNECTOR_SECRETS must be a JSON object');
  }

  const secrets: Record<string, Readonly<Record<string, string>>> = {};

  for (const [alias, aliasSecrets] of Object.entries(parsed)) {
    if (alias.trim().length === 0) {
      throw new Error('HTTP_CONNECTOR_SECRETS aliases must be non-empty');
    }

    if (!isPlainObject(aliasSecrets)) {
      throw new Error(`HTTP_CONNECTOR_SECRETS.${alias} must be a JSON object`);
    }

    const entries: Record<string, string> = {};

    for (const [key, value] of Object.entries(aliasSecrets)) {
      if (typeof value !== 'string') {
        throw new Error(`HTTP_CONNECTOR_SECRETS.${alias}.${key} must be a string`);
      }

      entries[key] = value;
    }

    secrets[alias] = entries;
  }

  return secrets;
}
