import { findFieldType } from '../fields/field-type.registry';
import { isPlainObject } from '../value-guards';
import { normalizeTransitionWebhook } from '../webhooks/webhook.normalizer';
import type { RawWorkflowStep } from '../workflow-contract';
import { failWorkflow } from '../workflow-invalid.error';
import type { WorkflowFieldDeclaration } from '../connectors/connector.normalizer';

const TERMINAL_STATUSES = ['approved', 'rejected', 'invalid'];
const MANUAL_TRANSITION_STATUSES = ['manual.approve', 'manual.reject', 'manual.invalid'];

export const isTerminalStatus = (status: string): boolean => TERMINAL_STATUSES.includes(status);

/** Field names are unique across the whole workflow, not just within a step. */
export const collectFieldDeclarations = (
  steps: readonly RawWorkflowStep[],
): Record<string, WorkflowFieldDeclaration> => {
  const declarationsByName: Record<string, WorkflowFieldDeclaration> = {};

  for (const step of steps) {
    for (const [fieldName, field] of Object.entries(step.data)) {
      if (declarationsByName[fieldName] !== undefined) {
        failWorkflow('DUPLICATE_FIELD_NAME');
      }

      declarationsByName[fieldName] = {
        stepName: step.name,
        persist: field.persist !== false,
      };
    }
  }

  return declarationsByName;
};

/** The declaration map is the single pass over step data; the workflow field names are its keys. */
export const collectFieldNames = (
  declarationsByName: Readonly<Record<string, WorkflowFieldDeclaration>>,
): Set<string> => new Set(Object.keys(declarationsByName));

/**
 * Enforces the per-step occurrence limits field types declare, such as at most one upload field
 * per step. Unknown type names are left to field normalization to reject.
 */
const validateFieldOccurrences = (step: RawWorkflowStep): void => {
  const occurrencesByType = new Map<string, number>();

  for (const field of Object.values(step.data)) {
    if (!isPlainObject(field)) {
      continue;
    }

    const typeName = (field as Record<string, unknown>).type;
    if (typeof typeName !== 'string') {
      continue;
    }

    const fieldType = findFieldType(typeName);
    if (fieldType?.maxOccurrencesPerStep === undefined) {
      continue;
    }

    const occurrences = (occurrencesByType.get(fieldType.type) ?? 0) + 1;
    if (occurrences > fieldType.maxOccurrencesPerStep) {
      failWorkflow('INVALID_VALUE');
    }

    occurrencesByType.set(fieldType.type, occurrences);
  }
};

/**
 * Step-level rules that do not depend on normalized fields: unique names, occurrence limits,
 * terminal-step emptiness and transition targets.
 */
export const validateStepCollection = (
  steps: readonly RawWorkflowStep[],
  initialName: string,
): void => {
  const stepNames = new Set<string>();

  for (const step of steps) {
    if (stepNames.has(step.name)) {
      failWorkflow('DUPLICATE_STEP_NAME');
    }
    stepNames.add(step.name);

    validateFieldOccurrences(step);
  }

  const initialStep = steps.find((step) => step.name === initialName);
  if (!initialStep) {
    failWorkflow('INVALID_VALUE');
  }

  for (const step of steps) {
    if (isTerminalStatus(step.status)) {
      if (Object.keys(step.data).length > 0 || step.transitions.length !== 0) {
        failWorkflow('INVALID_TERMINAL_STEP');
      }
      continue;
    }

    for (const transition of step.transitions) {
      const isManualOutcome = MANUAL_TRANSITION_STATUSES.includes(transition.status);

      if (transition.target !== undefined) {
        if (typeof transition.target !== 'string' || transition.target.trim().length === 0) {
          failWorkflow('INVALID_VALUE');
        }

        if (isManualOutcome && transition.target === step.name) {
          failWorkflow('INVALID_TRANSITIONS');
        }

        if (!isManualOutcome && !stepNames.has(transition.target)) {
          failWorkflow('UNKNOWN_TARGET');
        }
      } else if (isManualOutcome) {
        failWorkflow('INVALID_SHAPE');
      }

      if (transition.webhook !== undefined) {
        normalizeTransitionWebhook(transition.webhook);
      }
    }

    if (step.transitions.length < 1) {
      failWorkflow('INVALID_TRANSITIONS');
    }
  }

  if (isTerminalStatus((initialStep as RawWorkflowStep).status)) {
    failWorkflow('INVALID_TERMINAL_STEP');
  }
};
