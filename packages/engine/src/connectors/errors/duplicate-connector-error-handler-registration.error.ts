export class DuplicateConnectorErrorHandlerRegistrationError extends Error {
  constructor(id: string) {
    super(`Duplicate connector error handler registration for id=${id}`);
    this.name = 'DuplicateConnectorErrorHandlerRegistrationError';
  }
}
