/**
 * A connector declaration an adapter's `validateDeclaration` refused — a `sumsub_kyc` config
 * missing a key, an `http_request` URL that is not absolute. Raised by the registry so a caller can
 * tell an authoring defect from an infrastructure failure; the adapter's own message is kept
 * because it names the offending key.
 */
export class WorkflowConnectorDeclarationInvalidError extends Error {
  constructor(
    readonly stepName: string,
    readonly cause: Error,
  ) {
    super(cause.message);
    this.name = 'WorkflowConnectorDeclarationInvalidError';
  }
}
