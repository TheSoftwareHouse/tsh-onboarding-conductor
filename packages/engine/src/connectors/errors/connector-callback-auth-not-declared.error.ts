export class ConnectorCallbackAuthNotDeclaredError extends Error {
  constructor(type: string) {
    super(
      `Connector adapter type=${type} declares supportsAsyncCallback without a callbackAuth contract; declare an hmac recipe or an explicit { kind: none } justification`,
    );
    this.name = 'ConnectorCallbackAuthNotDeclaredError';
  }
}
