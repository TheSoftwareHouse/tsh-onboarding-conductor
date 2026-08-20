export class ConnectorMockNotRegisteredError extends Error {
  constructor(type: string, mockType: string) {
    super(
      `CONNECTOR_MOCKS asks for type=${type} to be served by type=${mockType}, but no adapter is registered as type=${mockType}`,
    );
    this.name = 'ConnectorMockNotRegisteredError';
  }
}
