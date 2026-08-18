export type ConnectorCallbackSecrets = Readonly<Record<string, readonly string[]>>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseSecretValues = (connectorType: string, value: unknown): readonly string[] => {
  const rawValues = Array.isArray(value) ? value : [value];

  if (rawValues.length === 0) {
    throw new Error(
      `CONNECTOR_CALLBACK_SIGNING_SECRETS.${connectorType} must list at least one secret`,
    );
  }

  return rawValues.map((rawValue) => {
    if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
      throw new Error(
        `CONNECTOR_CALLBACK_SIGNING_SECRETS.${connectorType} must contain non-empty string secrets`,
      );
    }

    return rawValue;
  });
};

/**
 * Signing secrets for inbound connector callbacks, keyed by connector type. A value
 * may be a single secret or a list, because provider-side rotation needs both the
 * outgoing and incoming secret to verify during the rotation window.
 */
export function parseConnectorCallbackSecrets(raw: string | undefined): ConnectorCallbackSecrets {
  const trimmed = raw?.trim() ?? '';

  if (trimmed.length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('CONNECTOR_CALLBACK_SIGNING_SECRETS must be valid JSON');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('CONNECTOR_CALLBACK_SIGNING_SECRETS must be a JSON object');
  }

  const secrets: Record<string, readonly string[]> = Object.create(null);

  for (const [connectorType, value] of Object.entries(parsed)) {
    if (connectorType.trim().length === 0) {
      throw new Error('CONNECTOR_CALLBACK_SIGNING_SECRETS connector types must be non-empty');
    }

    secrets[connectorType] = parseSecretValues(connectorType, value);
  }

  return secrets;
}
