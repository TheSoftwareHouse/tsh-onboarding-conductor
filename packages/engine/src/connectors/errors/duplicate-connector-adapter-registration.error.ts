export class DuplicateConnectorAdapterRegistrationError extends Error {
  constructor(id: string) {
    super(`Duplicate connector adapter registration for id=${id}`);
    this.name = 'DuplicateConnectorAdapterRegistrationError';
  }
}
