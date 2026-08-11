import {
  collectConditionReferences,
  createStepDataValidator,
  evaluateCondition,
  isNormalizedFileField,
  type NormalizedFileField,
  type NormalizedWorkflowConnectorDeclaration,
  type NormalizedWorkflowField,
  type NormalizedWorkflowStep,
  type NormalizedWorkflowTransition,
  type StepDataValidator,
  type WorkflowStatus,
  type WorkflowTransitionStatus,
} from '@tsh/ddl-schema';

export type StepDataEvaluationResult = {
  acceptedData: Record<string, unknown> | null;
  connectorData: Record<string, unknown> | null;
  fieldErrors: Readonly<Record<string, readonly string[]>>;
};

export class Step {
  private static readonly MAX_ACTIVE_VALIDATOR_CACHE_ENTRIES = 64;

  private readonly validator: StepDataValidator;
  private readonly validatorsByFieldName: Readonly<Record<string, StepDataValidator>>;
  private readonly orderedFieldNames: readonly string[];
  private readonly activeSubsetValidatorCache = new Map<string, StepDataValidator>();

  constructor(private readonly definition: NormalizedWorkflowStep) {
    this.validator = createStepDataValidator(this.definition);
    this.validatorsByFieldName = Object.fromEntries(
      Object.entries(this.definition.data).map(([fieldName, field]) => [
        fieldName,
        createStepDataValidator({ ...this.definition, data: { [fieldName]: field } }, [fieldName]),
      ]),
    );
    this.orderedFieldNames = this.resolveFieldOrder();
  }

  get name(): string {
    return this.definition.name;
  }

  get status(): WorkflowStatus {
    return this.definition.status;
  }

  get isTerminal(): boolean {
    return this.definition.terminal;
  }

  get connectors(): readonly NormalizedWorkflowConnectorDeclaration[] {
    return this.definition.connectors;
  }

  resolveTransition(
    trigger: WorkflowTransitionStatus,
    context?: Readonly<Record<string, unknown>>,
  ): NormalizedWorkflowTransition | undefined {
    return this.definition.transitions.find((candidate) => {
      if (candidate.status !== trigger) {
        return false;
      }

      return candidate.when === undefined || evaluateCondition(candidate.when, context);
    });
  }

  transitionTargetName(trigger: WorkflowTransitionStatus): string | null | undefined {
    const transition = this.resolveTransition(trigger);

    if (!transition) {
      return undefined;
    }

    return transition.target ?? null;
  }

  getFileFieldMetadata(): { fieldName: string; field: NormalizedFileField } | undefined {
    for (const [fieldName, field] of Object.entries(this.definition.data)) {
      if (isNormalizedFileField(field)) {
        return { fieldName, field };
      }
    }

    return undefined;
  }

  collectAcceptedData(
    submittedData: unknown,
    persistedContext?: Readonly<Record<string, unknown>>,
  ): StepDataEvaluationResult {
    if (!this.isSubmittedData(submittedData)) {
      return { acceptedData: null, connectorData: null, fieldErrors: {} };
    }

    const fieldErrors: Record<string, string[]> = {};
    const acceptedData: Record<string, unknown> = {};
    const connectorData: Record<string, unknown> = {};
    const conditionContext: Record<string, unknown> = { ...(persistedContext ?? {}) };
    const activeFieldNames: string[] = [];

    for (const submittedFieldName of Object.keys(submittedData)) {
      if (!Object.prototype.hasOwnProperty.call(this.definition.data, submittedFieldName)) {
        fieldErrors[submittedFieldName] = ['UNKNOWN'];
      }
    }

    for (const fieldName of this.orderedFieldNames) {
      const field = this.definition.data[fieldName];
      if (!evaluateCondition(field.when, conditionContext)) {
        if (Object.prototype.hasOwnProperty.call(submittedData, fieldName)) {
          fieldErrors[fieldName] = ['UNKNOWN'];
        }
        continue;
      }

      activeFieldNames.push(fieldName);

      if (!Object.prototype.hasOwnProperty.call(submittedData, fieldName)) {
        if (field.required) {
          fieldErrors[fieldName] = ['REQUIRED'];
        }
        continue;
      }

      const value = submittedData[fieldName];
      if (!this.isValidFieldValue(fieldName, field, value)) {
        fieldErrors[fieldName] = ['INVALID'];
        continue;
      }

      conditionContext[fieldName] = value;
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { acceptedData: null, connectorData: null, fieldErrors };
    }

    const activeValidator = this.resolveActiveSubsetValidator(activeFieldNames);
    if (!activeValidator(submittedData)) {
      const firstDeclaredField = Object.keys(submittedData).find((fieldName) =>
        Object.prototype.hasOwnProperty.call(this.definition.data, fieldName),
      );
      if (firstDeclaredField) {
        fieldErrors[firstDeclaredField] = ['INVALID'];
      }
      return { acceptedData: null, connectorData: null, fieldErrors };
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { acceptedData: null, connectorData: null, fieldErrors };
    }

    for (const fieldName of activeFieldNames) {
      const field = this.definition.data[fieldName];
      if (!Object.prototype.hasOwnProperty.call(submittedData, fieldName)) {
        continue;
      }

      const value = submittedData[fieldName];
      connectorData[fieldName] = value;
      if (field.persist !== false) {
        acceptedData[fieldName] = value;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { acceptedData: null, connectorData: null, fieldErrors };
    }

    return { acceptedData, connectorData, fieldErrors: {} };
  }

  private resolveFieldOrder(): string[] {
    const fieldNames = Object.keys(this.definition.data);
    const indegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const fieldName of fieldNames) {
      indegree.set(fieldName, 0);
      dependents.set(fieldName, []);
    }

    for (const fieldName of fieldNames) {
      const field = this.definition.data[fieldName];
      const dependencies = collectConditionReferences(field.when);
      for (const dependency of dependencies) {
        const dependencyIndex = fieldNames.indexOf(dependency);
        if (dependencyIndex === -1) {
          continue;
        }

        indegree.set(fieldName, (indegree.get(fieldName) ?? 0) + 1);
        const fieldDependents = dependents.get(dependency) ?? [];
        fieldDependents.push(fieldName);
        dependents.set(dependency, fieldDependents);
      }
    }

    const queue = fieldNames.filter((fieldName) => (indegree.get(fieldName) ?? 0) === 0);
    const orderedFieldNames: string[] = [];

    while (queue.length > 0) {
      const currentFieldName = queue.shift();
      if (!currentFieldName) {
        continue;
      }

      orderedFieldNames.push(currentFieldName);
      for (const dependent of dependents.get(currentFieldName) ?? []) {
        const nextIndegree = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, nextIndegree);
        if (nextIndegree === 0) {
          queue.push(dependent);
        }
      }
    }

    return orderedFieldNames.length === fieldNames.length ? orderedFieldNames : fieldNames;
  }

  private resolveActiveSubsetValidator(activeFieldNames: readonly string[]): StepDataValidator {
    const cacheKey = activeFieldNames.join('|');
    const cached = this.activeSubsetValidatorCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const compiled = createStepDataValidator(this.definition, [...activeFieldNames]);
    this.activeSubsetValidatorCache.set(cacheKey, compiled);

    if (
      this.activeSubsetValidatorCache.size > Step.MAX_ACTIVE_VALIDATOR_CACHE_ENTRIES &&
      this.activeSubsetValidatorCache.size > 0
    ) {
      const oldestCacheKey = this.activeSubsetValidatorCache.keys().next().value;
      if (oldestCacheKey !== undefined) {
        this.activeSubsetValidatorCache.delete(oldestCacheKey);
      }
    }

    return compiled;
  }

  private isSubmittedData(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isValidFieldValue(
    fieldName: string,
    field: NormalizedWorkflowField,
    value: unknown,
  ): boolean {
    const validator =
      this.validatorsByFieldName[fieldName] ??
      createStepDataValidator({ ...this.definition, data: { [fieldName]: field } }, [fieldName]);

    return validator({ [fieldName]: value });
  }
}
