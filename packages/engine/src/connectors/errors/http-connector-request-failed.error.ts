export class HttpConnectorRequestFailedError extends Error {
  constructor(
    public readonly stepName: string,
    reason: string,
  ) {
    super(`http_request connector call failed for step=${stepName}: ${reason}`);
    this.name = 'HttpConnectorRequestFailedError';
  }
}
