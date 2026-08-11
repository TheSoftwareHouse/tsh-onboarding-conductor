export class HttpConnectorConfigInvalidError extends Error {
  constructor(context: string, reason: string) {
    super(`Invalid http_request connector config (${context}): ${reason}`);
    this.name = 'HttpConnectorConfigInvalidError';
  }
}
