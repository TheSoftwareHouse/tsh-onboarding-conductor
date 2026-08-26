export class ConnectorMockTargetNotRegisteredError extends Error {
  constructor(id: string) {
    super(`CONNECTOR_MOCKS asks for id=${id} to be mocked, but no adapter serves it`);
    this.name = 'ConnectorMockTargetNotRegisteredError';
  }
}
