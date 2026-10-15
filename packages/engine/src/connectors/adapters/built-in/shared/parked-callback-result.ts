import {
  ConnectorExecutionResult,
  type ConnectorCallbackResult,
} from '../../../ports/connector-execution-result';
import type { AwaitingCallbackConnectorResolution } from '../../../resolvers/awaiting-callback-connector.resolver';

/** Re-parks the step with no decision applied — the redelivery-safe "acknowledge" response. */
export function buildParkedCallbackResult(
  connector: Readonly<{ id: string; name: string }>,
  onboardingId: string,
  resolvedConnector: AwaitingCallbackConnectorResolution,
): ConnectorCallbackResult {
  return {
    onboardingId,
    submittedData: {},
    resolvedConnector,
    // The stored record is spread first, or the re-park would forget the attempt it still
    // waits on and when it started waiting.
    result: ConnectorExecutionResult.pending({
      ...resolvedConnector.pendingConnector,
      connectorName: connector.name,
      connectorId: connector.id,
      connectorOrder: resolvedConnector.connectorOrder,
    }),
  };
}
