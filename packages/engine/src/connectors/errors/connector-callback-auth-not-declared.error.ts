export class ConnectorCallbackAuthNotDeclaredError extends Error {
  constructor(id: string) {
    super(
      `Connector adapter id=${id} declares supportsAsyncCallback without a callbackAuth contract; declare an hmac recipe or an explicit { kind: none } justification`,
    );
    this.name = 'ConnectorCallbackAuthNotDeclaredError';
  }
}
