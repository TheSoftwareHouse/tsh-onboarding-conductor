import { isPlainObject } from '../value-guards';
import type {
  CompiledWorkflowStep,
  NormalizedWorkflowField,
  NormalizedWorkflowStepAgreementDeclaration,
} from '../workflow-contract';
import { failWorkflow } from '../workflow-invalid.error';

/** Lowercase letters, digits and dashes, opening on an alphanumeric — the key is an identifier. */
const AGREEMENT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Normalizes a step's `agreements`: the agreement families this step collects acceptance for. A
 * declaration names the family only — which version is owed is the engine's to resolve, so a
 * document never states one.
 *
 * `acceptedWhen` must name a persisted boolean field of this same step. The submit path reads the
 * marker back out of the post-transition context, so a field belonging to another step, of another
 * type, or dropped by `persist: false` would leave the acceptance unobservable.
 */
export const normalizeStepAgreements = (
  step: CompiledWorkflowStep,
  normalizedData: Readonly<Record<string, NormalizedWorkflowField>>,
): readonly NormalizedWorkflowStepAgreementDeclaration[] => {
  if (step.agreements === undefined) {
    return [];
  }

  if (!Array.isArray(step.agreements)) {
    failWorkflow('INVALID_SHAPE');
  }

  const declaredKeys = new Set<string>();

  return step.agreements.map((agreement) => {
    if (!isPlainObject(agreement)) {
      failWorkflow('INVALID_SHAPE');
    }

    const agreementRecord = agreement as Record<string, unknown>;

    const key = agreementRecord.key;
    if (typeof key !== 'string' || !AGREEMENT_KEY_PATTERN.test(key)) {
      failWorkflow('INVALID_VALUE');
    }

    if (declaredKeys.has(key as string)) {
      failWorkflow('INVALID_VALUE');
    }
    declaredKeys.add(key as string);

    const acceptedWhen = agreementRecord.acceptedWhen;
    if (typeof acceptedWhen !== 'string') {
      failWorkflow('INVALID_VALUE');
    }

    const acceptanceField = normalizedData[acceptedWhen as string];
    if (acceptanceField === undefined) {
      failWorkflow('INVALID_VALUE');
    }

    if (acceptanceField.type !== 'boolean' || !acceptanceField.persist) {
      failWorkflow('INVALID_VALUE');
    }

    return { key: key as string, acceptedWhen: acceptedWhen as string };
  });
};
