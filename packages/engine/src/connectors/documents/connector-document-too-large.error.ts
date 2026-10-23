/**
 * A connector tried to store a document over `CONNECTOR_DOCUMENT_MAX_BYTES`. Internal: the adapter
 * that produced the bytes decides what the step learns (for `lean_bank_data`, `data_unavailable`).
 */
export class ConnectorDocumentTooLargeError extends Error {
  constructor(
    readonly connectorId: string,
    readonly sizeBytes: number,
    readonly maxBytes: number,
  ) {
    super(
      `${connectorId} produced a document of ${sizeBytes} bytes, over the ${maxBytes} byte cap`,
    );
    this.name = 'ConnectorDocumentTooLargeError';
  }
}
