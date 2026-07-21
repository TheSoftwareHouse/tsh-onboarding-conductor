import {
  createStepDataValidator,
  type NormalizedWorkflowConnectorDeclaration,
  type NormalizedWorkflowField,
  type NormalizedWorkflowStep,
  type StepDataValidator,
  type WorkflowStatus,
} from '@tsh/ddl-schema';

export class Step {
  private static readonly PROJECTION_FAILED = Symbol('projection_failed');

  private readonly validator: StepDataValidator;

  constructor(private readonly definition: NormalizedWorkflowStep) {
    this.validator = createStepDataValidator(this.definition);
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

  successTransitionTargetName(): string | undefined {
    return this.definition.transitions.find((candidate) => candidate.status === 'success')?.target;
  }

  collectAcceptedData(submittedData: unknown): Record<string, unknown> | null {
    if (!this.isSubmittedData(submittedData)) {
      return null;
    }

    if (!this.validator(submittedData)) {
      return null;
    }

    const acceptedData: Record<string, unknown> = {};
    for (const [fieldName, field] of Object.entries(this.definition.data)) {
      if (!Object.prototype.hasOwnProperty.call(submittedData, fieldName)) {
        if (field.required) {
          return null;
        }
        continue;
      }

      const value = submittedData[fieldName];
      const projectedValue = this.projectAcceptedValue(field, value);
      if (projectedValue === Step.PROJECTION_FAILED || projectedValue === undefined) {
        return null;
      }

      acceptedData[fieldName] = projectedValue;
    }

    return acceptedData;
  }

  private isSubmittedData(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private projectAcceptedValue(
    field: NormalizedWorkflowField,
    value: unknown,
  ): unknown | typeof Step.PROJECTION_FAILED {
    if (field.type === 'text' && field.validation?.format === 'credit-card') {
      if (typeof value !== 'string') {
        return Step.PROJECTION_FAILED;
      }

      const normalizedDigits = value.replace(/[\s-]/g, '');
      if (!/^\d+$/.test(normalizedDigits)) {
        return Step.PROJECTION_FAILED;
      }

      return `************${normalizedDigits.slice(-4)}`;
    }

    return value;
  }
}
