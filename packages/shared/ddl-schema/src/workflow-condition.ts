import { isFiniteNumber } from './value-guards';

export type WorkflowConditionScalar = string | number | boolean | null;

export type RawWorkflowCondition =
  | { all: readonly RawWorkflowCondition[] }
  | { any: readonly RawWorkflowCondition[] }
  | { not: RawWorkflowCondition }
  | { field: string; equals: WorkflowConditionScalar }
  | { field: string; in: readonly WorkflowConditionScalar[] }
  | { field: string; isSet: boolean }
  | { field: string; gte: number }
  | { field: string; lt: number };

export type NormalizedWorkflowCondition =
  | { all: readonly NormalizedWorkflowCondition[] }
  | { any: readonly NormalizedWorkflowCondition[] }
  | { not: NormalizedWorkflowCondition }
  | { field: string; equals: WorkflowConditionScalar }
  | { field: string; in: readonly WorkflowConditionScalar[] }
  | { field: string; isSet: boolean }
  | { field: string; gte: number }
  | { field: string; lt: number };

export type WorkflowConditionContext = Record<string, unknown>;

export function evaluateCondition(
  condition: RawWorkflowCondition | NormalizedWorkflowCondition | undefined,
  context: WorkflowConditionContext | undefined,
): boolean {
  if (condition == null) {
    return true;
  }

  if ('all' in condition) {
    return condition.all.every((childCondition) => evaluateCondition(childCondition, context));
  }

  if ('any' in condition) {
    return condition.any.some((childCondition) => evaluateCondition(childCondition, context));
  }

  if ('not' in condition) {
    return !evaluateCondition(condition.not, context);
  }

  if ('equals' in condition) {
    return (
      hasOwnProperty(context, condition.field) &&
      Object.is(getContextValue(context, condition.field), condition.equals)
    );
  }

  if ('in' in condition) {
    if (!hasOwnProperty(context, condition.field)) {
      return false;
    }

    const value = getContextValue(context, condition.field);
    return condition.in.some((literal) => Object.is(value, literal));
  }

  // A comparison is meaningful only against a number that is actually there. Anything else -
  // a missing key, a string, a null - makes the arm false rather than an error, so a document
  // comparing against a field the onboarding has not filled in yet simply does not match.
  if ('gte' in condition) {
    const value = getContextValue(context, condition.field);
    return isFiniteNumber(value) && value >= condition.gte;
  }

  if ('lt' in condition) {
    const value = getContextValue(context, condition.field);
    return isFiniteNumber(value) && value < condition.lt;
  }

  if ('isSet' in condition) {
    return condition.isSet
      ? hasOwnProperty(context, condition.field)
      : !hasOwnProperty(context, condition.field);
  }

  return false;
}

export function collectConditionReferences(
  condition: RawWorkflowCondition | NormalizedWorkflowCondition | undefined,
): readonly string[] {
  const references = new Set<string>();
  visitCondition(condition, references);
  return Array.from(references);
}

function visitCondition(
  condition: RawWorkflowCondition | NormalizedWorkflowCondition | undefined,
  references: Set<string>,
): void {
  if (condition == null) {
    return;
  }

  if ('all' in condition) {
    for (const childCondition of condition.all) {
      visitCondition(childCondition, references);
    }
    return;
  }

  if ('any' in condition) {
    for (const childCondition of condition.any) {
      visitCondition(childCondition, references);
    }
    return;
  }

  if ('not' in condition) {
    visitCondition(condition.not, references);
    return;
  }

  if ('field' in condition) {
    references.add(condition.field);
  }
}

function getContextValue(context: WorkflowConditionContext | undefined, field: string): unknown {
  return context?.[field];
}

function hasOwnProperty(context: WorkflowConditionContext | undefined, field: string): boolean {
  return context != null && Object.prototype.hasOwnProperty.call(context, field);
}
