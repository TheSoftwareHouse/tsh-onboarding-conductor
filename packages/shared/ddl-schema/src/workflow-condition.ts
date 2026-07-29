export type WorkflowConditionScalar = string | number | boolean | null;

export type RawWorkflowCondition =
  | { all: readonly RawWorkflowCondition[] }
  | { any: readonly RawWorkflowCondition[] }
  | { not: RawWorkflowCondition }
  | { field: string; equals: WorkflowConditionScalar }
  | { field: string; in: readonly WorkflowConditionScalar[] }
  | { field: string; isSet: boolean };

export type NormalizedWorkflowCondition =
  | { all: readonly NormalizedWorkflowCondition[] }
  | { any: readonly NormalizedWorkflowCondition[] }
  | { not: NormalizedWorkflowCondition }
  | { field: string; equals: WorkflowConditionScalar }
  | { field: string; in: readonly WorkflowConditionScalar[] }
  | { field: string; isSet: boolean };

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
