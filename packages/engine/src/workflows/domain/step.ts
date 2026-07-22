import {
  createStepDataValidator,
  type NormalizedWorkflowConnectorDeclaration,
  type NormalizedWorkflowField,
  type NormalizedWorkflowStep,
  type NormalizedWorkflowWebhookDeclaration,
  type StepDataValidator,
  type WorkflowStatus,
} from '@tsh/ddl-schema';

type WorkflowTransitionStatus =
  'success' | 'rejected' | 'manual.approve' | 'manual.reject' | 'manual.return';

export type StepDataEvaluationResult = {
  acceptedData: Record<string, unknown> | null;
  fieldErrors: Readonly<Record<string, readonly string[]>>;
};

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

  get webhook(): NormalizedWorkflowWebhookDeclaration | undefined {
    return this.definition.webhook;
  }

  hasVerifyCodeConnector(): boolean {
    return this.definition.connectors.some((connector) => connector.method === 'verifyCode');
  }

  transitionTargetName(trigger: WorkflowTransitionStatus): string | null | undefined {
    const transition = this.definition.transitions.find(
      (candidate) => candidate.status === trigger,
    );

    if (!transition) {
      return undefined;
    }

    return transition.target ?? null;
  }

  getFileFieldMetadata(): { fieldName: string; field: NormalizedWorkflowField } | undefined {
    const entry = Object.entries(this.definition.data).find(([, field]) => field.type === 'file');

    if (!entry) {
      return undefined;
    }

    const [fieldName, field] = entry;
    return { fieldName, field };
  }

  collectAcceptedData(submittedData: unknown): StepDataEvaluationResult {
    if (!this.isSubmittedData(submittedData)) {
      return { acceptedData: null, fieldErrors: {} };
    }

    const fieldErrors: Record<string, string[]> = {};
    const acceptedData: Record<string, unknown> = {};

    for (const submittedFieldName of Object.keys(submittedData)) {
      if (!Object.prototype.hasOwnProperty.call(this.definition.data, submittedFieldName)) {
        fieldErrors[submittedFieldName] = ['UNKNOWN'];
      }
    }

    for (const [fieldName, field] of Object.entries(this.definition.data)) {
      if (!Object.prototype.hasOwnProperty.call(submittedData, fieldName)) {
        if (field.required) {
          fieldErrors[fieldName] = ['REQUIRED'];
        }
        continue;
      }

      const value = submittedData[fieldName];
      const projectedValue = this.projectAcceptedValue(field, value);
      if (projectedValue === Step.PROJECTION_FAILED || projectedValue === undefined) {
        fieldErrors[fieldName] = ['INVALID'];
        continue;
      }

      acceptedData[fieldName] = projectedValue;
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { acceptedData: null, fieldErrors };
    }

    if (!this.validator(submittedData)) {
      const firstDeclaredField = Object.keys(submittedData).find((fieldName) =>
        Object.prototype.hasOwnProperty.call(this.definition.data, fieldName),
      );
      if (firstDeclaredField) {
        fieldErrors[firstDeclaredField] = ['INVALID'];
      }
      return { acceptedData: null, fieldErrors };
    }

    return { acceptedData, fieldErrors: {} };
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
