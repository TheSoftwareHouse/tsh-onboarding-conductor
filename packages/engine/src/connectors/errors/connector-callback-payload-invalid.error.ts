/**
 * The adapter could not read the callback as its provider's payload: not JSON, not an object, or
 * missing the identifiers that correlate it. The provider sent something that can never apply, so
 * the webhook route answers 400 `CALLBACK_PAYLOAD_INVALID` and records the drop.
 */
export class ConnectorCallbackPayloadInvalidError extends Error {
  constructor(connectorId: string, reason: string) {
    super(`Callback for connector id=${connectorId} carries an unreadable payload: ${reason}`);
    this.name = 'ConnectorCallbackPayloadInvalidError';
  }
}
