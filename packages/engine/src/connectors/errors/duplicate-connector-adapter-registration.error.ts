export class DuplicateConnectorAdapterRegistrationError extends Error {
  constructor(type: string) {
    super(`Duplicate connector adapter registration for type=${type}`);
    this.name = 'DuplicateConnectorAdapterRegistrationError';
  }
}
