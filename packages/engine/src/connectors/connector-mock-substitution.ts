import { ConnectorMockNotRegisteredError } from './errors/connector-mock-not-registered.error';
import { ConnectorMockTargetNotRegisteredError } from './errors/connector-mock-target-not-registered.error';
import type { ConnectorAdapterCollection } from './ports/connector-adapter.port';

export const CONNECTOR_MOCK_SUBSTITUTIONS = Symbol('CONNECTOR_MOCK_SUBSTITUTIONS');

/** Connector type -> the mock connector type serving it for this run. */
export type ConnectorMockSubstitutions = ReadonlyMap<string, string>;

/**
 * Decides which of the configured CONNECTOR_MOCKS pairs this run actually applies. The pairs
 * are ordinary configuration and may sit in any environment's `.env`; only a test run puts a
 * fake in a real connector's place, so anywhere else they resolve to nothing.
 *
 * Where they do apply, both ends have to exist: a connector nobody serves, or a mock that was
 * never registered, fails at startup rather than quietly leaving the real provider in place.
 */
export const resolveConnectorMockSubstitutions = (
  adapters: ConnectorAdapterCollection,
  mocks: ReadonlyMap<string, string>,
  nodeEnv: string | undefined,
): ConnectorMockSubstitutions => {
  if (nodeEnv?.trim().toLowerCase() !== 'test') {
    return new Map();
  }

  const serves = (type: string) => adapters.some((adapter) => adapter.type === type);

  for (const [connectorType, mockConnectorType] of mocks) {
    if (!serves(connectorType)) {
      throw new ConnectorMockTargetNotRegisteredError(connectorType);
    }

    if (!serves(mockConnectorType)) {
      throw new ConnectorMockNotRegisteredError(connectorType, mockConnectorType);
    }
  }

  return new Map(mocks);
};
