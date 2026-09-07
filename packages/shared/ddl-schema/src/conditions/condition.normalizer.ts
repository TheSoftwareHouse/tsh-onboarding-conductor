import type { AnyNormalizedField } from '../fields/field-type.port';
import { getFieldType } from '../fields/field-type.registry';
import { isFiniteNumber, isInteger, isPlainObject } from '../value-guards';
import {
  collectConditionReferences,
  type NormalizedWorkflowCondition,
  type WorkflowConditionScalar,
} from '../workflow-condition';
import { WORKFLOW_SCORE_COMPARATORS, type WorkflowScoreComparator } from '../workflow-contract';
import { failWorkflow } from '../workflow-invalid.error';

const CONDITION_KEYS: readonly string[] = [
  'all',
  'any',
  'not',
  'field',
  'equals',
  'in',
  'isSet',
  'score',
  ...WORKFLOW_SCORE_COMPARATORS,
];

export type ConditionNormalizationContext = {
  rootFieldNames: ReadonlySet<string>;
  fieldDefinitionsByName: Readonly<Record<string, AnyNormalizedField>>;
  /** Set while normalizing a field's own `when`, so it cannot reference itself. */
  currentFieldName?: string;
  /**
   * The names a root `scoring` block declares. Set only while normalizing a transition's `when` —
   * a score leaf reaching this function without it means it was reached from a field's `when` or a
   * scoring rule's `when`, where a score leaf is not legal.
   */
  declaredScores?: ReadonlySet<string>;
};

const isWorkflowConditionScalar = (value: unknown): value is WorkflowConditionScalar => {
  if (value === null) {
    return true;
  }

  return typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value);
};

const normalizeConditionLiteral = (value: unknown): WorkflowConditionScalar => {
  if (!isWorkflowConditionScalar(value)) {
    failWorkflow('INVALID_VALUE');
  }

  return value as WorkflowConditionScalar;
};

/**
 * A literal is only comparable when the referenced field's type says so; types that cannot be
 * compared at all (`file`, `object`, `array`) simply do not implement the rule.
 */
const validateLiteralCompatibility = (
  value: WorkflowConditionScalar,
  field: AnyNormalizedField,
): void => {
  if (value === null) {
    return;
  }

  const validateLiteral = getFieldType(field.type).validateConditionLiteral;
  if (validateLiteral === undefined) {
    return failWorkflow('INVALID_VALUE');
  }

  validateLiteral(value, field, failWorkflow);
};

/** Builds the normalized score leaf for one of the four ordered comparators. */
const buildScoreComparison = (
  scoreName: string,
  comparator: WorkflowScoreComparator,
  threshold: number,
): NormalizedWorkflowCondition => {
  switch (comparator) {
    case 'gte':
      return { score: scoreName, gte: threshold };
    case 'gt':
      return { score: scoreName, gt: threshold };
    case 'lte':
      return { score: scoreName, lte: threshold };
    case 'lt':
      return { score: scoreName, lt: threshold };
  }
};

const normalizeScoreComparison = (
  conditionRecord: Record<string, unknown>,
  keys: readonly string[],
  context: ConditionNormalizationContext,
): NormalizedWorkflowCondition => {
  if (context.declaredScores === undefined) {
    failWorkflow('UNKNOWN_PROPERTY');
  }

  const declaredScores = context.declaredScores as ReadonlySet<string>;
  const comparatorKeys = keys.filter((key) =>
    (WORKFLOW_SCORE_COMPARATORS as readonly string[]).includes(key),
  );
  if (keys.length !== 2 || comparatorKeys.length !== 1) {
    failWorkflow('INVALID_SHAPE');
  }

  const scoreName = conditionRecord.score;
  if (typeof scoreName !== 'string' || scoreName.trim().length === 0) {
    failWorkflow('INVALID_VALUE');
  }

  const referencedScoreName = scoreName as string;
  if (!declaredScores.has(referencedScoreName)) {
    failWorkflow('INVALID_VALUE');
  }

  const comparator = comparatorKeys[0] as WorkflowScoreComparator;
  const threshold = conditionRecord[comparator];
  if (!isInteger(threshold)) {
    failWorkflow('INVALID_VALUE');
  }

  return buildScoreComparison(referencedScoreName, comparator, threshold as number);
};

export const normalizeCondition = (
  condition: unknown,
  context: ConditionNormalizationContext,
): NormalizedWorkflowCondition | undefined => {
  if (condition === undefined) {
    return undefined;
  }

  if (!isPlainObject(condition)) {
    failWorkflow('INVALID_SHAPE');
  }

  const conditionRecord = condition as Record<string, unknown>;
  const keys = Object.keys(conditionRecord);
  if (keys.some((key) => !CONDITION_KEYS.includes(key))) {
    failWorkflow('UNKNOWN_PROPERTY');
  }

  for (const branchKey of ['all', 'any'] as const) {
    if (!(branchKey in conditionRecord)) {
      continue;
    }

    if (keys.length !== 1) {
      failWorkflow('INVALID_SHAPE');
    }

    const branch = conditionRecord[branchKey];
    if (!Array.isArray(branch) || branch.length === 0) {
      failWorkflow('INVALID_SHAPE');
    }

    const children = (branch as readonly unknown[]).map(
      (childCondition) =>
        normalizeCondition(childCondition, context) as NormalizedWorkflowCondition,
    );

    return branchKey === 'all' ? { all: children } : { any: children };
  }

  if ('not' in conditionRecord) {
    if (keys.length !== 1) {
      failWorkflow('INVALID_SHAPE');
    }

    return {
      not: normalizeCondition(conditionRecord.not, context) as NormalizedWorkflowCondition,
    };
  }

  if ('score' in conditionRecord) {
    return normalizeScoreComparison(conditionRecord, keys, context);
  }

  if ('field' in conditionRecord) {
    const operatorKeys = keys.filter((key) => key === 'equals' || key === 'in' || key === 'isSet');
    if (keys.length !== 2 || operatorKeys.length !== 1) {
      failWorkflow('INVALID_SHAPE');
    }

    const fieldName = conditionRecord.field;
    if (typeof fieldName !== 'string' || fieldName.trim().length === 0) {
      failWorkflow('INVALID_VALUE');
    }

    const referencedFieldName = fieldName as string;
    if (!context.rootFieldNames.has(referencedFieldName)) {
      failWorkflow('INVALID_VALUE');
    }
    if (
      context.currentFieldName !== undefined &&
      referencedFieldName === context.currentFieldName
    ) {
      failWorkflow('INVALID_VALUE');
    }

    const referencedField = context.fieldDefinitionsByName[referencedFieldName];
    if (referencedField === undefined) {
      failWorkflow('INVALID_VALUE');
    }

    const operator = operatorKeys[0] as 'equals' | 'in' | 'isSet';
    if (operator === 'isSet') {
      if (typeof conditionRecord.isSet !== 'boolean') {
        failWorkflow('INVALID_VALUE');
      }

      return { field: referencedFieldName, isSet: conditionRecord.isSet as boolean };
    }

    if (operator === 'equals') {
      const normalizedLiteral = normalizeConditionLiteral(conditionRecord.equals);
      validateLiteralCompatibility(normalizedLiteral, referencedField);

      return { field: referencedFieldName, equals: normalizedLiteral };
    }

    const values = conditionRecord.in;
    if (!Array.isArray(values) || values.length === 0) {
      failWorkflow('INVALID_SHAPE');
    }

    return {
      field: referencedFieldName,
      in: (values as readonly unknown[]).map((value) => {
        const normalizedValue = normalizeConditionLiteral(value);
        validateLiteralCompatibility(normalizedValue, referencedField);
        return normalizedValue;
      }),
    };
  }

  return failWorkflow('INVALID_SHAPE');
};

/**
 * A field's visibility may not depend on itself, directly or through another field's condition.
 */
export const validateFieldDependencies = (
  fieldDefinitionsByName: Readonly<Record<string, AnyNormalizedField>>,
): void => {
  const state = new Map<string, 'visiting' | 'visited'>();

  const visit = (fieldName: string): void => {
    const fieldState = state.get(fieldName);
    if (fieldState === 'visiting') {
      failWorkflow('INVALID_VALUE');
    }
    if (fieldState === 'visited') {
      return;
    }

    state.set(fieldName, 'visiting');

    const field = fieldDefinitionsByName[fieldName];
    if (field?.when !== undefined) {
      for (const dependency of collectConditionReferences(field.when)) {
        if (fieldDefinitionsByName[dependency] !== undefined) {
          visit(dependency);
        }
      }
    }

    state.set(fieldName, 'visited');
  };

  for (const fieldName of Object.keys(fieldDefinitionsByName)) {
    visit(fieldName);
  }
};
