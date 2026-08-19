export class ConnectorMockTargetNotRegisteredError extends Error {
  constructor(type: string) {
    super(`CONNECTOR_MOCKS asks for type=${type} to be mocked, but no adapter serves it`);
    this.name = 'ConnectorMockTargetNotRegisteredError';
  }
}
