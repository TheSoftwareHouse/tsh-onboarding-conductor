const CONNECTOR_TYPE_PATTERN = /^[a-z0-9_]+$/;

/**
 * Which mock stands in for which connector, as `<connector type>:<mock connector type>` pairs:
 *
 *   CONNECTOR_MOCKS=twilio_verify:mock_phone_verification,sendgrid_email:mock_email_delivery
 *
 * Every substitution is named here, so running against a fake is always a deliberate
 * decision; the engine refuses to boot with a non-empty value outside NODE_ENV=test.
 */
export function parseConnectorMocks(raw: string | undefined): ReadonlyMap<string, string> {
  const trimmed = raw?.trim() ?? '';
  const mocks = new Map<string, string>();

  if (trimmed.length === 0) {
    return mocks;
  }

  for (const entry of trimmed.split(',')) {
    const [connectorType, mockConnectorType, ...rest] = entry.split(':').map((part) => part.trim());

    if (
      rest.length > 0 ||
      !CONNECTOR_TYPE_PATTERN.test(connectorType ?? '') ||
      !CONNECTOR_TYPE_PATTERN.test(mockConnectorType ?? '')
    ) {
      throw new Error(
        `CONNECTOR_MOCKS entries must be <connector type>:<mock connector type> pairs of lowercase types matching ${CONNECTOR_TYPE_PATTERN.source}`,
      );
    }

    if (connectorType === mockConnectorType) {
      throw new Error(`CONNECTOR_MOCKS cannot replace type=${connectorType} with itself`);
    }

    mocks.set(connectorType, mockConnectorType);
  }

  return mocks;
}
