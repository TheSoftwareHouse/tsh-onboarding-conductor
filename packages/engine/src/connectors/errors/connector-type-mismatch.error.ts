/**
 * A workflow's connector declaration repeats its adapter's capability as `type`. When the two
 * disagree the adapter wins and the workflow is refused, because a document that misreports what
 * it calls is worse than no classification at all.
 */
export class ConnectorTypeMismatchError extends Error {
  constructor(id: string, declaredType: string, adapterType: string) {
    super(
      `Connector declaration for id=${id} declares type=${declaredType}, but the registered adapter is type=${adapterType}`,
    );
    this.name = 'ConnectorTypeMismatchError';
  }
}
