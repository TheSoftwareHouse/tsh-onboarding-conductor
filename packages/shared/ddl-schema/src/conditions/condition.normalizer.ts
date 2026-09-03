import type { AnyNormalizedField } from '../fields/field-type.port';
import { getFieldType } from '../fields/field-type.registry';
import { numberFieldTypeDefinition } from '../fields/number.field-type';
import { CONDITION_VARIABLE_TYPES, isConditionVariable } from '../scoring/condition-variable';
import { isFiniteNumber, isPlainObject } from '../value-guards';
import {
  collectConditionReferences,
  type NormalizedWorkflowCondition,
  type WorkflowConditionScalar,
} from '../workflow-condition';
import { failWorkflow } from '../workflow-invalid.error';

const OPERATOR_KEYS = ['equals', 'in', 'isSet', 'gte', 'lt'] as const;

type ConditionOperator = (typeof OPERATOR_KEYS)[number];

/**
 * The operators that compare magnitude rather than identity. They are the only ones a numeric
 * condition variable accepts, and against a declared field they are only meaningful when that
 * field holds a number.
 */
const COMPARISON_OPERATORS: readonly ConditionOperator[] = ['gte', 'lt'];

const isComparisonOperator = (operator: ConditionOperator): operator is 'gte' | 'lt' =>
  COMPARISON_OPERATORS.includes(operator);

const CONDITION_KEYS = ['all', 'any', 'not', 'field', ...OPERATOR_KEYS];

export type ConditionNormalizationContext = {
  rootFieldNames: ReadonlySet<string>;
  fieldDefinitionsByName: Readonly<Record<string, AnyNormalizedField>>;
  /** Set while normalizing a field's own `when`, so it cannot reference itself. */
  currentFieldName?: string;
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

/** A threshold is a plain finite number; `gte: "80"` is a mistake rather than a coercion. */
const normalizeThreshold = (value: unknown): number => {
  if (!isFiniteNumber(value)) {
    failWorkflow('INVALID_VALUE');
  }

  return value as number;
};

const buildComparison = (
  fieldName: string,
  operator: 'gte' | 'lt',
  threshold: number,
): NormalizedWorkflowCondition =>
  operator === 'gte' ? { field: fieldName, gte: threshold } : { field: fieldName, lt: threshold };

/**
 * An engine-provided variable such as `$score` is not a declared field, so the root-field and
 * field-type checks do not apply to it. Stricter rules do. It may only appear where the engine
 * can actually supply a value — a transition or `skip` condition, never a field's own `when`,
 * which the client re-resolves as the form fills and has no score to resolve against. And it
 * compares magnitude only: equality against a running total is a trap rather than a rule
 * anyone means to write, so `equals`, `in` and `isSet` are refused.
 */
const normalizeVariableComparison = (
  variableName: string,
  operator: ConditionOperator,
  conditionRecord: Record<string, unknown>,
  context: ConditionNormalizationContext,
): NormalizedWorkflowCondition => {
  if (context.currentFieldName !== undefined) {
    failWorkflow('INVALID_VALUE');
  }

  if (CONDITION_VARIABLE_TYPES[variableName] === undefined) {
    failWorkflow('INVALID_VALUE');
  }

  if (!isComparisonOperator(operator)) {
    failWorkflow('INVALID_VALUE');
  }

  return buildComparison(
    variableName,
    operator as 'gte' | 'lt',
    normalizeThreshold(conditionRecord[operator]),
  );
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

  if ('field' in conditionRecord) {
    const operatorKeys = keys.filter((key) => OPERATOR_KEYS.includes(key as ConditionOperator));
    if (keys.length !== 2 || operatorKeys.length !== 1) {
      failWorkflow('INVALID_SHAPE');
    }

    const fieldName = conditionRecord.field;
    if (typeof fieldName !== 'string' || fieldName.trim().length === 0) {
      failWorkflow('INVALID_VALUE');
    }

    const referencedFieldName = fieldName as string;
    const operator = operatorKeys[0] as ConditionOperator;

    // Checked before the root-field lookup: a variable is deliberately not a declared field, so
    // every check below this point would reject it for the wrong reason.
    if (isConditionVariable(referencedFieldName)) {
      return normalizeVariableComparison(referencedFieldName, operator, conditionRecord, context);
    }

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

    if (isComparisonOperator(operator)) {
      // Ordering against a name, a date or a file has no meaning the DDL could define.
      if (referencedField.type !== numberFieldTypeDefinition.type) {
        failWorkflow('INVALID_VALUE');
      }

      return buildComparison(
        referencedFieldName,
        operator,
        normalizeThreshold(conditionRecord[operator]),
      );
    }

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
