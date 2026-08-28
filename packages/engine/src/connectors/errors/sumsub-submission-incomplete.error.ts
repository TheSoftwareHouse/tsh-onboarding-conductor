import type { SumsubDocSetKey } from '../adapters/built-in/sumsub-kyc/sumsub-contract';

/**
 * Sumsub refuses `finalizeSubmission` with a `409` when required docSets are still missing. The
 * response names them; this error carries that list back to the caller instead of the adapter
 * re-parsing provider text.
 */
export class SumsubSubmissionIncompleteError extends Error {
  constructor(
    applicantId: string,
    public readonly missingDocSets: readonly SumsubDocSetKey[],
  ) {
    super(
      `Sumsub applicant ${applicantId} cannot be finalized: missing docSets ${missingDocSets.join(', ')}`,
    );
    this.name = 'SumsubSubmissionIncompleteError';
  }
}
