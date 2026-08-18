const CONNECTOR_TYPE_PATTERN = /^[a-z0-9_]+$/;

/**
 * Connector types whose providers do not sign their callbacks, accepted as unauthenticated
 * ingress on purpose. Production requires every such connector to be named here, so accepting
 * unsigned callbacks is always a deliberate deployment decision rather than a default.
 */
export function parseConnectorCallbackUnsignedTypes(raw: string | undefined): readonly string[] {
  const trimmed = raw?.trim() ?? '';

  if (trimmed.length === 0) {
    return [];
  }

  const connectorTypes = trimmed.split(',').map((entry) => entry.trim());
  const unsignedTypes: string[] = [];

  for (const connectorType of connectorTypes) {
    if (!CONNECTOR_TYPE_PATTERN.test(connectorType)) {
      throw new Error(
        `CONNECTOR_CALLBACK_UNSIGNED_TYPES entries must be lowercase connector types matching ${CONNECTOR_TYPE_PATTERN.source}`,
      );
    }

    if (!unsignedTypes.includes(connectorType)) {
      unsignedTypes.push(connectorType);
    }
  }

  return unsignedTypes;
}
