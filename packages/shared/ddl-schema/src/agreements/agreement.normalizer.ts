import { isPlainObject } from '../value-guards';
import type {
  CompiledWorkflowDefinition,
  NormalizedWorkflowAgreementDeclaration,
  NormalizedWorkflowStep,
} from '../workflow-contract';
import { failWorkflow } from '../workflow-invalid.error';

/** Lowercase letters, digits and dashes, opening on an alphanumeric — the key is an identifier. */
const AGREEMENT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Normalizes a workflow's `agreements`: the agreement families it collects acceptance for. A
 * declaration names the family only — which version is owed is the engine's to resolve, so a
 * document never states one.
 *
 * A family is declared once: the same key twice would owe one link from two bindings, with nothing
 * to say which of them settles it. `step` must name a step of this workflow and `acceptedWhen` a
 * persisted boolean field of that step, since the submit path reads the marker back out of the
 * post-transition context — a field of another step, of another type, or dropped by
 * `persist: false` would leave the acceptance unobservable.
 */
export const normalizeWorkflowAgreements = (
  definition: CompiledWorkflowDefinition,
  stepsByName: Readonly<Record<string, NormalizedWorkflowStep>>,
): readonly NormalizedWorkflowAgreementDeclaration[] => {
  if (definition.agreements === undefined) {
    return [];
  }

  if (!Array.isArray(definition.agreements)) {
    failWorkflow('INVALID_SHAPE', 'agreements');
  }

  const declaredKeys = new Set<string>();

  return definition.agreements.map((agreement, index) => {
    const path = `agreements[${index}]`;

    if (!isPlainObject(agreement)) {
      failWorkflow('INVALID_SHAPE', path);
    }

    const agreementRecord = agreement as Record<string, unknown>;

    const key = agreementRecord.key;
    if (typeof key !== 'string' || !AGREEMENT_KEY_PATTERN.test(key)) {
      failWorkflow('INVALID_VALUE', `${path}.key`);
    }

    if (declaredKeys.has(key as string)) {
      failWorkflow('INVALID_VALUE', `${path}.key`);
    }
    declaredKeys.add(key as string);

    const step = agreementRecord.step;
    if (typeof step !== 'string') {
      failWorkflow('INVALID_VALUE', `${path}.step`);
    }

    const acceptanceStep = stepsByName[step as string];
    if (acceptanceStep === undefined) {
      failWorkflow('UNKNOWN_TARGET', `${path}.step`);
    }

    const acceptedWhen = agreementRecord.acceptedWhen;
    if (typeof acceptedWhen !== 'string') {
      failWorkflow('INVALID_VALUE', `${path}.acceptedWhen`);
    }

    const acceptanceField = acceptanceStep.data[acceptedWhen as string];
    if (acceptanceField === undefined) {
      failWorkflow('INVALID_VALUE', `${path}.acceptedWhen`);
    }

    if (acceptanceField.type !== 'boolean' || !acceptanceField.persist) {
      failWorkflow('INVALID_VALUE', `${path}.acceptedWhen`);
    }

    return {
      key: key as string,
      step: step as string,
      acceptedWhen: acceptedWhen as string,
    };
  });
};
