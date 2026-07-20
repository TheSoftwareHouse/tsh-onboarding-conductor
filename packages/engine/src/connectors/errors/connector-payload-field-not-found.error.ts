export class ConnectorPayloadFieldNotFoundError extends Error {
  constructor(sourceField: string, connectorType: string, connectorName: string) {
    super(
      `Connector payload field not found in context: sourceField=${sourceField}, type=${connectorType}, name=${connectorName}`,
    );
    this.name = 'ConnectorPayloadFieldNotFoundError';
  }
}
