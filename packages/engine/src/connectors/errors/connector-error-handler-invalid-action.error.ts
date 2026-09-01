/**
 * A handler is third-party code by design — the whole point of the port is that third parties
 * write handlers — so its `handle` may return anything. This names that specific failure mode,
 * distinct from a database problem, and carries the offending handler's own `id`.
 */
export class ConnectorErrorHandlerInvalidActionError extends Error {
  constructor(handlerId: string, action: unknown) {
    super(`Connector error handler id=${handlerId} returned an invalid action=${String(action)}`);
    this.name = 'ConnectorErrorHandlerInvalidActionError';
  }
}
