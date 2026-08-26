export class ConnectorMockNotRegisteredError extends Error {
  constructor(id: string, mockId: string) {
    super(
      `CONNECTOR_MOCKS asks for id=${id} to be served by id=${mockId}, but no adapter is registered as id=${mockId}`,
    );
    this.name = 'ConnectorMockNotRegisteredError';
  }
}
