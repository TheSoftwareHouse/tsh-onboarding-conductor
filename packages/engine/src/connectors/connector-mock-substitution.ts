import { ConnectorMockNotRegisteredError } from './errors/connector-mock-not-registered.error';
import { ConnectorMockTargetNotRegisteredError } from './errors/connector-mock-target-not-registered.error';
import type { ConnectorAdapterCollection } from './ports/connector-adapter.port';

export const CONNECTOR_MOCK_SUBSTITUTIONS = Symbol('CONNECTOR_MOCK_SUBSTITUTIONS');

/** Connector id -> the id of the mock connector serving it for this run. */
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

  const serves = (id: string) => adapters.some((adapter) => adapter.id === id);

  for (const [connectorId, mockConnectorId] of mocks) {
    if (!serves(connectorId)) {
      throw new ConnectorMockTargetNotRegisteredError(connectorId);
    }

    if (!serves(mockConnectorId)) {
      throw new ConnectorMockNotRegisteredError(connectorId, mockConnectorId);
    }
  }

  return new Map(mocks);
};
