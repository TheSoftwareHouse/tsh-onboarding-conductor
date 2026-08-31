export class ConnectorAdapterNotRegisteredError extends Error {
  constructor(id: string) {
    super(`Connector adapter not registered for id=${id}`);
    this.name = 'ConnectorAdapterNotRegisteredError';
  }
}
