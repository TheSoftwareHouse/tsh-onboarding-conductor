export class ConnectorErrorHandlerNotRegisteredError extends Error {
  constructor(id: string) {
    super(`Connector error handler not registered for id=${id}`);
    this.name = 'ConnectorErrorHandlerNotRegisteredError';
  }
}
