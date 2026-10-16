import type { ObjectStoragePort } from '../../../../storage/object-storage.port';
import type { ConnectorExecutionInput } from '../../../ports/connector-adapter.port';
import type { CompletedOnboardingDocumentResolver } from '../../../resolvers/completed-onboarding-document.resolver';
import { readCompletedDocument } from '../shared/read-completed-document';
import { CREDIT_BANK_DATA_CONTENT_TYPE, CREDIT_BANK_DATA_FIELD } from './credit-contract';
import {
  CreditBankDataInvalidError,
  type CreditApplicant,
  type CreditSubmission,
} from './credit-provider.port';

const CREDIT_APPLICANT_ROLES = ['firstName', 'lastName', 'email'] as const;

const readOptionalString = (
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined => {
  const value = payload[key];

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

/**
 * The roles the workflow bound, read from the payload. The step type maps each opted-in role as a
 * `fieldMapping` key of the same name, so the payload carries the role under its own name. A role
 * with no answer stays absent.
 */
function buildCreditApplicant(
  payload: Readonly<Record<string, unknown>>,
): CreditApplicant | undefined {
  const applicant = Object.fromEntries(
    CREDIT_APPLICANT_ROLES.flatMap((role) => {
      const value = readOptionalString(payload, role);

      return value === undefined ? [] : [[role, value]];
    }),
  );

  return Object.keys(applicant).length === 0 ? undefined : applicant;
}

/**
 * Assembles what a provider needs before any provider call: the `bankData` document resolved
 * through the step's `fieldMapping` and read from object storage, the bound applicant roles, and
 * the attempt number. `undefined` means the step cannot be submitted as it stands — no document
 * reference, or one that resolves to no completed document. A document that is not JSON throws
 * `CreditBankDataInvalidError`, the client's to fix.
 */
export async function buildCreditSubmission(
  connectorId: string,
  input: ConnectorExecutionInput,
  attempt: number,
  documentResolver: CompletedOnboardingDocumentResolver,
  objectStoragePort: ObjectStoragePort,
): Promise<CreditSubmission | undefined> {
  const documentId = input.payload[CREDIT_BANK_DATA_FIELD];

  if (typeof documentId !== 'string' || documentId.trim().length === 0) {
    return undefined;
  }

  const source = input.payloadFieldSources[CREDIT_BANK_DATA_FIELD];
  const read = await readCompletedDocument(documentResolver, objectStoragePort, {
    documentId,
    onboardingId: input.execution.onboardingId,
    sourceField: typeof source === 'string' ? source : CREDIT_BANK_DATA_FIELD,
  });

  if (!read) {
    return undefined;
  }

  const { resolved, content } = read;

  if (resolved.contentType.split(';')[0].trim().toLowerCase() !== CREDIT_BANK_DATA_CONTENT_TYPE) {
    throw new CreditBankDataInvalidError(
      connectorId,
      `content type ${resolved.contentType} is not ${CREDIT_BANK_DATA_CONTENT_TYPE}`,
    );
  }

  return {
    onboardingId: input.execution.onboardingId,
    attempt,
    applicant: buildCreditApplicant(input.payload),
    bankData: { format: 'json', document: content, contentType: resolved.contentType },
  };
}
