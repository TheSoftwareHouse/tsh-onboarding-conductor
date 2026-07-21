import type {
  NormalizedWorkflowDefinition,
  NormalizedWorkflowField,
  NormalizedWorkflowStep,
  WorkflowStatus,
} from '@tsh/ddl-schema';
import type { ConnectorExecutionPort } from '../../connectors/ports/connector-execution.port';
import type {
  OnboardingActiveStepDescriptor,
  OnboardingJourneyFieldDescriptor,
  OnboardingJourneyValidationKind,
} from '@tsh/shared';

export type WorkflowInitializationResult = {
  workflowId: string;
  workflowVersion: number;
  status: WorkflowStatus;
  currentStep: string | null;
};

export type WorkflowEvaluationInput = {
  currentStep: string | null | undefined;
  submittedData: unknown;
  onboardingContext: Readonly<Record<string, unknown>>;
};

export type WorkflowEvaluationResult =
  | {
      kind: 'accepted';
      acceptedData: Record<string, unknown>;
      appliedStep: string;
      status: WorkflowStatus;
      currentStep: string | null;
      terminal: boolean;
    }
  | {
      kind: 'rejected';
      appliedStep: string;
      status: WorkflowStatus;
      currentStep: string | null;
      terminal: boolean;
      problem: {
        type: string;
        title: string;
        status: 400;
        code: 'INVALID_STEP_DATA';
        fieldErrors: Array<{ field: string; code: string }>;
      };
      fieldErrors: Array<{ field: string; code: string }>;
    };

type WorkflowFieldErrorCode =
  'REQUIRED' | 'INVALID_FORMAT' | 'INVALID_TYPE' | 'MUST_BE_TRUE' | 'UNDECLARED_FIELD';

type ValidationOutcome =
  | {
      kind: 'accepted';
      acceptedData: Record<string, unknown>;
    }
  | {
      kind: 'rejected';
      fieldErrors: Array<{ field: string; code: WorkflowFieldErrorCode }>;
    };

export class Workflow {
  constructor(
    private readonly definition: NormalizedWorkflowDefinition,
    private readonly connectorExecutionPort?: ConnectorExecutionPort,
  ) {}

  get id(): string {
    return this.definition.id;
  }

  get version(): number {
    return this.definition.version;
  }

  initialize(): WorkflowInitializationResult {
    const initialStep = this.definition.stepsByName[this.definition.initial];

    return {
      workflowId: this.definition.id,
      workflowVersion: this.definition.version,
      status: this.targetStatus(initialStep),
      currentStep: initialStep && this.isTerminalStep(initialStep) ? null : (initialStep?.name ?? null),
    };
  }

  describeActiveStep(
    currentStep: string | null | undefined,
  ): OnboardingActiveStepDescriptor | null {
    const step = this.activeStep(currentStep);
    if (!step) {
      return null;
    }

    return {
      stepId: step.name,
      fields: Object.entries(step.data).map(([name, field]) => this.toFieldDescriptor(name, field)),
    };
  }

  async evaluate(input: WorkflowEvaluationInput): Promise<WorkflowEvaluationResult | undefined> {
    const currentStep = this.activeStep(input.currentStep);

    if (!currentStep || this.isTerminalStep(currentStep)) {
      return undefined;
    }

    if (!this.isSubmittedData(input.submittedData)) {
      return undefined;
    }

    const validation = this.validateAndCollectData(currentStep, input.submittedData);
    if (validation.kind === 'rejected') {
      const problem = this.buildInvalidStepDataProblem(validation.fieldErrors);

      return {
        kind: 'rejected',
        appliedStep: currentStep.name,
        status: currentStep.status,
        currentStep: currentStep.name,
        terminal: false,
        problem,
        fieldErrors: problem.fieldErrors,
      };
    }

    const target = this.resolveSuccessTarget(currentStep);
    if (!target) {
      return undefined;
    }

    if (this.connectorExecutionPort) {
      const connectorContext = { ...input.onboardingContext, ...validation.acceptedData };
      await this.connectorExecutionPort.execute(currentStep.connectors, connectorContext);
    }

    const acceptedData = this.buildAcceptedData(currentStep, validation.acceptedData);
    const terminal = this.isTerminalStep(target);

    return {
      kind: 'accepted',
      acceptedData,
      appliedStep: currentStep.name,
      status: this.targetStatus(target),
      currentStep: terminal ? null : target.name,
      terminal,
    };
  }

  private activeStep(currentStep: string | null | undefined): NormalizedWorkflowStep | undefined {
    return typeof currentStep === 'string' ? this.definition.stepsByName[currentStep] : undefined;
  }

  private isTerminalStep(step: NormalizedWorkflowStep): boolean {
    return step.terminal;
  }

  private isSubmittedData(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private validateAndCollectData(
    step: NormalizedWorkflowStep,
    submittedData: Record<string, unknown>,
  ): ValidationOutcome {
    const declaredFields = Object.keys(step.data);
    const submittedFields = Object.keys(submittedData);
    const fieldErrors: Array<{ field: string; code: WorkflowFieldErrorCode }> = [];

    for (const fieldName of submittedFields) {
      if (!declaredFields.includes(fieldName)) {
        fieldErrors.push({ field: fieldName, code: 'UNDECLARED_FIELD' });
      }
    }

    const acceptedData: Record<string, unknown> = {};
    for (const fieldName of declaredFields) {
      const field = step.data[fieldName];
      const value = submittedData[fieldName];

      if (field.required && value === undefined) {
        fieldErrors.push({ field: fieldName, code: 'REQUIRED' });
        continue;
      }

      if (value === undefined) {
        continue;
      }

      const validationCode = this.validateFieldValue(field, value);
      if (validationCode) {
        fieldErrors.push({ field: fieldName, code: validationCode });
        continue;
      }

      acceptedData[fieldName] = value;
    }

    if (fieldErrors.length > 0) {
      return { kind: 'rejected', fieldErrors };
    }

    return { kind: 'accepted', acceptedData };
  }

  private buildAcceptedData(
    step: NormalizedWorkflowStep,
    validatedFields: Record<string, unknown>,
  ): Record<string, unknown> {
    if (step.name === 'collect_contact') {
      const acceptedData: Record<string, unknown> = {};
      const email = validatedFields.email as string;
      const phone = validatedFields.phone as string;
      const marketingConsent = validatedFields.marketingConsent;

      acceptedData['contact.email'] = email;
      acceptedData['contact.phone'] = phone;
      acceptedData['consent.termsVersion'] = 'v1';
      acceptedData['consent.termsAcceptedAt'] = new Date().toISOString();
      acceptedData['consent.privacyVersion'] = 'v1';
      acceptedData['consent.privacyAcknowledgedAt'] = new Date().toISOString();
      if (marketingConsent === true) {
        acceptedData['consent.marketingConsent'] = true;
        acceptedData['consent.marketingConsentRecordedAt'] = new Date().toISOString();
      }

      return acceptedData;
    }

    return { ...validatedFields };
  }

  private validateFieldValue(
    field: NormalizedWorkflowField,
    value: unknown,
  ): WorkflowFieldErrorCode | null {
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') {
        return 'INVALID_TYPE';
      }

      return value === true ? null : 'MUST_BE_TRUE';
    }

    if (field.type !== 'text') {
      return 'INVALID_TYPE';
    }

    if (typeof value !== 'string') {
      return 'INVALID_TYPE';
    }

    const format = field.validation?.format;
    if (format === 'email') {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'INVALID_FORMAT';
    }

    if (format === 'phone') {
      return value.length > 0 && /^\+[1-9]\d{5,14}$/.test(value) ? null : 'INVALID_FORMAT';
    }

    return null;
  }

  private buildInvalidStepDataProblem(fieldErrors: Array<{ field: string; code: string }>): {
    type: string;
    title: string;
    status: 400;
    code: 'INVALID_STEP_DATA';
    fieldErrors: Array<{ field: string; code: string }>;
  } {
    return {
      type: '/problems/invalid-step-data',
      title: 'Invalid step data',
      status: 400,
      code: 'INVALID_STEP_DATA',
      fieldErrors,
    };
  }

  private toFieldDescriptor(
    name: string,
    field: NormalizedWorkflowField,
  ): OnboardingJourneyFieldDescriptor {
    return {
      name,
      type: field.type === 'boolean' ? 'boolean' : 'string',
      required: field.required,
      persist: field.persist,
      validation: {
        kind: this.toValidationKind(field),
      },
    };
  }

  private toValidationKind(field: NormalizedWorkflowField): OnboardingJourneyValidationKind {
    if (field.type === 'boolean') {
      return 'must-be-true';
    }

    return field.type === 'text' && field.validation?.format === 'phone' ? 'phone' : 'email';
  }

  private resolveSuccessTarget(
    currentStep: NormalizedWorkflowStep,
  ): NormalizedWorkflowStep | undefined {
    const transition = currentStep.transitions.find((candidate) => candidate.status === 'success');
    if (!transition) {
      return undefined;
    }

    return this.definition.stepsByName[transition.target];
  }

  private targetStatus(step: NormalizedWorkflowStep | undefined): WorkflowStatus {
    return step?.status ?? 'awaiting_user';
  }
}
