import type { ObjectStoragePort } from '../../../../storage/object-storage.port';
import type { ConnectorExecutionInput } from '../../../ports/connector-adapter.port';
import type { CompletedOnboardingDocumentResolver } from '../../../resolvers/completed-onboarding-document.resolver';
import { readCompletedDocument } from '../shared/read-completed-document';
import {
  CREDIT_ACCOUNT_POSITION_PREFIX,
  CREDIT_ACCOUNT_SELECTION_FIELD,
  CREDIT_BANK_DATA_CONTENT_TYPE,
  CREDIT_BANK_DATA_FIELD,
} from './credit-contract';
import {
  CreditBankDataInvalidError,
  type CreditApplicant,
  type CreditSubmission,
} from './credit-provider.port';

/** The selection names positions the document does not have, or nothing at all. */
export class CreditNoAccountsSelectedError extends Error {
  constructor(
    readonly connectorId: string,
    readonly sourceField: string,
  ) {
    super(`${connectorId} was given a selection naming no account of the document`);
    this.name = 'CreditNoAccountsSelectedError';
  }
}

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

/** `account-01` → 0; anything else is not a position and is ignored. */
const parsePosition = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !value.startsWith(CREDIT_ACCOUNT_POSITION_PREFIX)) {
    return undefined;
  }

  const position = Number(value.slice(CREDIT_ACCOUNT_POSITION_PREFIX.length));

  return Number.isInteger(position) && position >= 1 ? position - 1 : undefined;
};

/**
 * Keeps the positions of the document's top-level `accounts` the selection names, in document
 * order; a position past the end is ignored. The one shape the kernel assumes of a bank-data
 * document (0051): a JSON object with an `accounts` array. Anything else is the client's
 * `INVALID_BANK_DATA`; a selection that keeps nothing is `CreditNoAccountsSelectedError`.
 */
function narrowToSelection(
  connectorId: string,
  content: Buffer,
  selection: readonly unknown[],
  sourceField: string,
): Buffer {
  let document: unknown;

  try {
    document = JSON.parse(content.toString('utf8'));
  } catch {
    throw new CreditBankDataInvalidError(connectorId, 'not valid JSON');
  }

  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new CreditBankDataInvalidError(connectorId, 'document is not an object');
  }

  const { accounts } = document as { accounts?: unknown };

  if (!Array.isArray(accounts)) {
    throw new CreditBankDataInvalidError(connectorId, 'accounts must be an array');
  }

  const positions = new Set(
    selection.map(parsePosition).filter((position): position is number => position !== undefined),
  );
  const kept = accounts.filter((_account, index) => positions.has(index));

  if (kept.length === 0) {
    throw new CreditNoAccountsSelectedError(connectorId, sourceField);
  }

  return Buffer.from(JSON.stringify({ ...document, accounts: kept }));
}

/**
 * Assembles what a provider needs before any provider call: the `bankData` document resolved
 * through the step's `fieldMapping` and read from object storage — narrowed to the accounts an
 * `accountSelection` names, when the step maps one — the bound applicant roles, and the attempt
 * number. `undefined` means the step cannot be submitted as it stands — no document reference, or
 * one that resolves to no completed document. A document that is not JSON throws
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

  const selection = input.payload[CREDIT_ACCOUNT_SELECTION_FIELD];
  const selectionSource = input.payloadFieldSources[CREDIT_ACCOUNT_SELECTION_FIELD];
  const document = Array.isArray(selection)
    ? narrowToSelection(
        connectorId,
        content,
        selection,
        typeof selectionSource === 'string' ? selectionSource : CREDIT_ACCOUNT_SELECTION_FIELD,
      )
    : content;

  return {
    onboardingId: input.execution.onboardingId,
    attempt,
    applicant: buildCreditApplicant(input.payload),
    bankData: { format: 'json', document, contentType: resolved.contentType },
  };
}
