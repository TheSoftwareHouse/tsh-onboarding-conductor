import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
import { ConnectorExecutionResult } from '../../connectors/ports/connector-execution-result';
import type { ConnectorExecutionPort } from '../../connectors/ports/connector-execution.port';
import { Workflow } from './workflow';

const baseWorkflowConfigPath = resolve(__dirname, '../../../../../workflows/base.workflow.json');
const baseWorkflowConfig = JSON.parse(readFileSync(baseWorkflowConfigPath, 'utf8'));

describe('Workflow', () => {
  const definition = validateAndNormalizeWorkflow(baseWorkflowConfig);
  let workflow: Workflow;
  let connectorExecutionPort: ConnectorExecutionPort;

  const createFileWorkflow = () => {
    const fileDefinition = validateAndNormalizeWorkflow({
      id: 'file-step',
      version: 1,
      name: 'File Step',
      initial: 'collect_data',
      steps: [
        {
          name: 'collect_data',
          status: 'awaiting_user',
          data: {
            identityDocument: {
              type: 'file',
              required: true,
              validation: {
                contentTypes: ['image/png', 'image/jpeg'],
                maxSizeBytes: 5242880,
              },
            },
            documentLabel: {
              type: 'text',
              required: true,
              validation: { minLength: 1 },
            },
          },
          transitions: [{ status: 'success', target: 'finished' }],
        },
        {
          name: 'finished',
          status: 'approved',
          data: {},
          transitions: [],
        },
      ],
    });

    return new Workflow(fileDefinition);
  };

  beforeEach(() => {
    connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
    };
    workflow = new Workflow(definition, connectorExecutionPort);
  });

  it('initializes from normalized workflow metadata', () => {
    expect(workflow.initialize()).toEqual({
      workflowId: 'base',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: 'collect_email',
    });
  });

  it('returns source-step webhook only for configured source steps', () => {
    expect(workflow.getSourceStepWebhook('collect_email')).toBeUndefined();
    expect(workflow.getSourceStepWebhook('accept_terms')).toEqual({
      eventType: 'onboarding.state_changed',
      path: 'onboarding/accept_terms',
    });
    expect(workflow.getSourceStepWebhook('approved')).toBeUndefined();
    expect(workflow.getSourceStepWebhook(null)).toBeUndefined();
  });

  it('validates fields, runs connector execution, and resolves the declared non-terminal target', async () => {
    const data = { email: 'person@example.com' };
    const onboardingContext = { firstName: 'Ada' };
    const result = await workflow.evaluate({
      currentStep: 'collect_email',
      submittedData: data,
      onboardingContext,
      onboardingId: 'onboarding-123',
    });

    expect(result).toEqual({
      acceptedData: { email: 'person@example.com' },
      appliedStep: 'collect_email',
      nextState: {
        context: { firstName: 'Ada', email: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'accept_terms',
        completedAt: null,
        rejectionReason: null,
      },
    });
    expect(result).toBeDefined();
    expect(data).toEqual({ email: 'person@example.com' });
    expect(onboardingContext).toEqual({ firstName: 'Ada' });
    expect(connectorExecutionPort.execute).toHaveBeenCalledWith(
      definition.stepsByName.collect_email.connectors,
      { firstName: 'Ada', email: 'person@example.com' },
      { onboardingId: 'onboarding-123', stepName: 'collect_email' },
    );
    expect((connectorExecutionPort.execute as jest.Mock).mock.calls[0][1]).not.toBe(data);
    expect((connectorExecutionPort.execute as jest.Mock).mock.calls[0][1]).not.toBe(
      onboardingContext,
    );

    if (result) {
      const nextState = result.getNextState();
      if (nextState) {
        (nextState.context.email as string) = 'changed@example.com';
      }
    }
    expect(data).toEqual({ email: 'person@example.com' });
    expect(onboardingContext).toEqual({ firstName: 'Ada' });
  });

  it('returns invalid UNKNOWN_STATE for a file step when connector execution rejects the reference', async () => {
    const connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.invalid()),
    } as unknown as ConnectorExecutionPort;
    const fileWorkflow = new Workflow(
      validateAndNormalizeWorkflow({
        id: 'file-upload',
        version: 1,
        name: 'File Upload',
        initial: 'collect_identity',
        steps: [
          {
            name: 'collect_identity',
            status: 'awaiting_user',
            data: {
              identityDocument: {
                type: 'file',
                required: true,
                validation: { contentTypes: ['image/png'], maxSizeBytes: 1024 },
              },
            },
            connectors: [
              {
                name: 'mock_sumsub_file_upload',
                type: 'mock_sumsub_file_upload',
                order: 1,
                fieldMapping: { documentId: 'identityDocument' },
              },
            ],
            transitions: [{ status: 'success', target: 'approved' }],
          },
          {
            name: 'approved',
            status: 'approved',
            data: {},
            transitions: [],
          },
        ],
      }),
      connectorExecutionPort,
    );

    const result = await fileWorkflow.evaluate({
      currentStep: 'collect_identity',
      submittedData: { identityDocument: 'document-123' },
      onboardingContext: { persisted: 'value' },
      onboardingId: 'onboarding-123',
    });

    expect(result.isTerminalInvalid()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
    expect(result.getAppliedStep()).toBe('collect_identity');
    expect(result.getNextState()).toMatchObject({
      context: { persisted: 'value' },
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
  });

  it('preserves the file-step transition when connector execution accepts the reference', async () => {
    const connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
    } as unknown as ConnectorExecutionPort;
    const fileWorkflow = new Workflow(
      validateAndNormalizeWorkflow({
        id: 'file-upload',
        version: 1,
        name: 'File Upload',
        initial: 'collect_identity',
        steps: [
          {
            name: 'collect_identity',
            status: 'awaiting_user',
            data: {
              identityDocument: {
                type: 'file',
                required: true,
                validation: { contentTypes: ['image/png'], maxSizeBytes: 1024 },
              },
              documentLabel: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'mock_sumsub_file_upload',
                type: 'mock_sumsub_file_upload',
                order: 1,
                fieldMapping: { documentId: 'identityDocument' },
              },
            ],
            transitions: [{ status: 'success', target: 'approved' }],
          },
          {
            name: 'approved',
            status: 'approved',
            data: {},
            transitions: [],
          },
        ],
      }),
      connectorExecutionPort,
    );

    await expect(
      fileWorkflow.evaluate({
        currentStep: 'collect_identity',
        submittedData: { identityDocument: 'document-123', documentLabel: 'passport' },
        onboardingContext: {},
        onboardingId: 'onboarding-123',
      }),
    ).resolves.toEqual({
      acceptedData: { identityDocument: 'document-123', documentLabel: 'passport' },
      appliedStep: 'collect_identity',
      nextState: {
        context: { identityDocument: 'document-123', documentLabel: 'passport' },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
      },
    });
  });

  it('resolves terminal state with completedAt from target metadata', async () => {
    const before = Date.now();
    await expect(
      workflow.evaluate({
        currentStep: 'accept_terms',
        submittedData: { acceptedTerms: true },
        onboardingContext: { email: 'person@example.com' },
        onboardingId: 'onboarding-123',
      }),
    ).resolves.toMatchObject({
      appliedStep: 'accept_terms',
      nextState: {
        context: { email: 'person@example.com', acceptedTerms: true },
        status: 'approved',
        currentStep: null,
        rejectionReason: null,
      },
    });
    const evaluation = await workflow.evaluate({
      currentStep: 'accept_terms',
      submittedData: { acceptedTerms: true },
      onboardingContext: { email: 'person@example.com' },
      onboardingId: 'onboarding-123',
    });
    expect(evaluation?.getNextState()?.completedAt).toBeInstanceOf(Date);
    expect((evaluation?.getNextState()?.completedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(connectorExecutionPort.execute).toHaveBeenCalledWith(
      definition.stepsByName.accept_terms.connectors,
      { email: 'person@example.com', acceptedTerms: true },
      { onboardingId: 'onboarding-123', stepName: 'accept_terms' },
    );
  });

  it('supports recursive success and manual review outcomes without re-entering the step', async () => {
    const manualWorkflow = new Workflow(
      validateAndNormalizeWorkflow({
        id: 'manual-review',
        version: 1,
        name: 'Manual Review',
        initial: 'collect_data',
        steps: [
          {
            name: 'collect_data',
            status: 'awaiting_user',
            data: {
              email: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            transitions: [{ status: 'success' }, { status: 'manual.invalid', target: 'invalid' }],
          },
          {
            name: 'review',
            status: 'awaiting_manual_review',
            data: {},
            transitions: [
              { status: 'manual.approve', target: 'approved' },
              { status: 'manual.reject', target: 'rejected' },
              { status: 'manual.invalid', target: 'invalid' },
            ],
          },
          {
            name: 'approved',
            status: 'approved',
            data: {},
            transitions: [],
          },
          {
            name: 'rejected',
            status: 'rejected',
            data: {},
            transitions: [],
          },
          {
            name: 'invalid',
            status: 'invalid',
            data: {},
            transitions: [],
          },
        ],
      }),
    );

    await expect(
      manualWorkflow.evaluate({
        currentStep: 'collect_data',
        submittedData: { email: 'person@example.com' },
        onboardingContext: {},
        onboardingId: '01912345-6789-7abc-8def-0123456789ab',
      }),
    ).resolves.toEqual({
      acceptedData: { email: 'person@example.com' },
      appliedStep: 'collect_data',
      nextState: {
        context: { email: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'collect_data',
        completedAt: null,
        rejectionReason: null,
      },
    });

    expect(
      manualWorkflow.evaluateManual(
        {
          currentStep: 'review',
          submittedData: undefined,
          onboardingContext: { reviewerNote: 'looks-good' },
        },
        'manual.approve',
      ),
    ).toEqual({
      acceptedData: {},
      appliedStep: 'review',
      nextState: {
        context: { reviewerNote: 'looks-good' },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
      },
    });

    expect(
      manualWorkflow.evaluateManual(
        {
          currentStep: 'review',
          submittedData: undefined,
          onboardingContext: { reviewerNote: 'needs-fix' },
        },
        'manual.invalid',
      ),
    ).toEqual({
      acceptedData: {},
      appliedStep: 'review',
      nextState: {
        context: { reviewerNote: 'needs-fix' },
        status: 'invalid',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
      },
    });

    const rejectedManualResult = manualWorkflow.evaluateManual(
      {
        currentStep: 'review',
        submittedData: undefined,
        onboardingContext: { reviewerNote: 'needs-fix' },
      },
      'manual.reject',
    );
    expect(rejectedManualResult.getNextState()).toMatchObject({
      status: 'rejected',
      currentStep: null,
      completedAt: expect.any(Date),
      rejectionReason: null,
    });
    expect(rejectedManualResult.getNextState()?.rejectionReason).toBeNull();

    const invalidManualResult = manualWorkflow.evaluateManual(
      {
        currentStep: 'collect_data',
        submittedData: undefined,
        onboardingContext: { reviewerNote: 'n/a' },
      },
      'manual.approve',
    );
    expect(invalidManualResult.isManualTransitionUnavailable()).toBe(true);
    expect(invalidManualResult.getReason()).toBe('UNKNOWN_STATE');
  });

  it.each([
    ['missing field', 'collect_email', {}],
    ['undeclared field', 'collect_email', { other: 'value' }],
    ['wrong type', 'collect_email', { email: 42 }],
    ['invalid email', 'collect_email', { email: 'invalid' }],
    ['false const', 'accept_terms', { acceptedTerms: false }],
    ['malformed body', 'collect_email', null],
    ['array body', 'collect_email', []],
  ])(
    'returns terminal invalid for %s runtime input',
    async (_description, currentStep, submittedData) => {
      const result = await workflow.evaluate({
        currentStep,
        submittedData,
        onboardingContext: { persisted: true },
        onboardingId: 'onboarding-123',
      });

      expect(result.isTerminalInvalid()).toBe(true);
      expect(result.getReason()).toBe('UNKNOWN_STATE');
      expect(result.getAppliedStep()).toBe(currentStep);
      expect(result.getNextState()).toMatchObject({
        context: { persisted: true },
        status: 'invalid',
        currentStep: null,
        rejectionReason: null,
      });
      expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
      expect(connectorExecutionPort.execute).not.toHaveBeenCalled();
    },
  );

  it('returns invalid UNKNOWN_STATE for a terminal step runtime input', async () => {
    const result = await workflow.evaluate({
      currentStep: 'approved',
      submittedData: {},
      onboardingContext: { persisted: true },
      onboardingId: 'onboarding-123',
    });

    expect(result.isTerminalInvalid()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
    expect(result.getAppliedStep()).toBeUndefined();
    expect(result.getNextState()).toMatchObject({
      context: { persisted: true },
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
    expect(connectorExecutionPort.execute).not.toHaveBeenCalled();
  });

  it('masks card values and preserves IBAN casing while copying only declared data', async () => {
    const customDefinition = validateAndNormalizeWorkflow({
      id: 'custom',
      version: 1,
      name: 'Custom',
      initial: 'collect_data',
      steps: [
        {
          name: 'collect_data',
          status: 'awaiting_user',
          data: {
            cardNumber: {
              type: 'text',
              required: true,
              validation: { format: 'credit-card' },
            },
            iban: {
              type: 'text',
              required: true,
              validation: { format: 'account-number' },
            },
            status: {
              type: 'text',
              required: true,
              validation: { oneOf: ['active', 'pending'] },
            },
            tags: {
              type: 'text',
              required: false,
              validation: { manyOf: ['vip', 'urgent'] },
            },
            age: {
              type: 'number',
              required: true,
              validation: { minimum: 18 },
            },
            acceptedTerms: {
              type: 'boolean',
              required: true,
              validation: { oneOf: [true] },
            },
          },
          transitions: [{ status: 'success', target: 'finished' }],
        },
        {
          name: 'finished',
          status: 'approved',
          data: {},
          transitions: [],
        },
      ],
    });

    const customWorkflow = new Workflow(customDefinition);
    const submittedData = {
      cardNumber: '4111-1111-1111-1111',
      iban: '  de89 3704 0044 0532 0130 00 ',
      status: 'active',
      age: 21,
      acceptedTerms: true,
    };

    const result = await customWorkflow.evaluate({
      currentStep: 'collect_data',
      submittedData,
      onboardingContext: {},
      onboardingId: 'onboarding-123',
    });

    expect(result).toEqual({
      acceptedData: {
        cardNumber: '************1111',
        iban: '  de89 3704 0044 0532 0130 00 ',
        status: 'active',
        age: 21,
        acceptedTerms: true,
      },
      appliedStep: 'collect_data',
      nextState: {
        context: {
          cardNumber: '************1111',
          iban: '  de89 3704 0044 0532 0130 00 ',
          status: 'active',
          age: 21,
          acceptedTerms: true,
        },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
      },
    });
    expect(submittedData).toEqual({
      cardNumber: '4111-1111-1111-1111',
      iban: '  de89 3704 0044 0532 0130 00 ',
      status: 'active',
      age: 21,
      acceptedTerms: true,
    });
  });

  it('accepts valid falsy values and keeps submitted input unchanged', async () => {
    const customDefinition = validateAndNormalizeWorkflow({
      id: 'custom-falsy',
      version: 1,
      name: 'Custom Falsy',
      initial: 'collect_data',
      steps: [
        {
          name: 'collect_data',
          status: 'awaiting_user',
          data: {
            approved: {
              type: 'boolean',
              required: true,
            },
            retries: {
              type: 'number',
              required: true,
              validation: { minimum: 0 },
            },
            note: {
              type: 'text',
              required: true,
              validation: { minLength: 0 },
            },
          },
          transitions: [{ status: 'success', target: 'finished' }],
        },
        {
          name: 'finished',
          status: 'approved',
          data: {},
          transitions: [],
        },
      ],
    });

    const customWorkflow = new Workflow(customDefinition);
    const submittedData = {
      approved: false,
      retries: 0,
      note: '',
    };

    const result = await customWorkflow.evaluate({
      currentStep: 'collect_data',
      submittedData,
      onboardingContext: {},
      onboardingId: 'onboarding-123',
    });

    expect(result).toEqual({
      acceptedData: {
        approved: false,
        retries: 0,
        note: '',
      },
      appliedStep: 'collect_data',
      nextState: {
        context: {
          approved: false,
          retries: 0,
          note: '',
        },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
      },
    });
    expect(submittedData).toEqual({
      approved: false,
      retries: 0,
      note: '',
    });

    if (result) {
      const nextState = result.getNextState();
      if (nextState) {
        (nextState.context.note as string) = 'updated';
      }
    }
    expect(submittedData).toEqual({
      approved: false,
      retries: 0,
      note: '',
    });
  });

  it('exposes active file-field metadata and accepts a valid document id with sibling fields', async () => {
    const fileWorkflow = createFileWorkflow();
    const submittedData = {
      documentLabel: 'passport',
      identityDocument: 'document-123',
    };

    const result = await fileWorkflow.evaluate({
      currentStep: 'collect_data',
      submittedData,
      onboardingContext: {},
      onboardingId: 'onboarding-123',
    });

    expect(fileWorkflow.getActiveFileFieldMetadata('collect_data')).toEqual({
      fieldName: 'identityDocument',
      field: {
        type: 'file',
        required: true,
        validation: {
          contentTypes: ['image/png', 'image/jpeg'],
          maxSizeBytes: 5242880,
        },
      },
    });
    expect(result).toEqual({
      appliedStep: 'collect_data',
      acceptedData: {
        documentLabel: 'passport',
        identityDocument: 'document-123',
      },
      nextState: {
        context: {
          documentLabel: 'passport',
          identityDocument: 'document-123',
        },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
      },
    });
    expect(submittedData).toEqual({
      documentLabel: 'passport',
      identityDocument: 'document-123',
    });
  });

  it('rejects missing, empty, or wrong-type file document data without mutating the body', async () => {
    const fileWorkflow = createFileWorkflow();

    for (const submittedData of [
      { documentLabel: 'passport' },
      { documentLabel: 'passport', identityDocument: '' },
      { documentLabel: 'passport', identityDocument: 123 },
    ]) {
      const clone = { ...submittedData };
      const result = await fileWorkflow.evaluate({
        currentStep: 'collect_data',
        submittedData: clone,
        onboardingContext: {},
        onboardingId: 'onboarding-123',
      });
      expect(result.isTerminalInvalid()).toBe(true);
      expect(result.getReason()).toBe('UNKNOWN_STATE');
      expect(result.getAppliedStep()).toBe('collect_data');
      expect(result.getNextState()).toMatchObject({
        context: {},
        status: 'invalid',
        currentStep: null,
        rejectionReason: null,
      });
      expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
      expect(clone).toEqual(submittedData);
    }
  });

  it('returns invalid UNKNOWN_STATE for an unknown server-held current step without mutating the body', async () => {
    const data = { email: 'person@example.com' };

    const result = await workflow.evaluate({
      currentStep: 'missing-step',
      submittedData: data,
      onboardingContext: { persisted: true },
      onboardingId: 'onboarding-123',
    });

    expect(result.isTerminalInvalid()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
    expect(result.getAppliedStep()).toBeUndefined();
    expect(result.getNextState()).toMatchObject({
      context: { persisted: true },
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
    expect(data).toEqual({ email: 'person@example.com' });
    expect(connectorExecutionPort.execute).not.toHaveBeenCalled();
  });

  it('returns invalid UNKNOWN_STATE when connector execution returns invalid', async () => {
    const data = { email: 'person@example.com' };
    (connectorExecutionPort.execute as jest.Mock).mockResolvedValueOnce(
      ConnectorExecutionResult.invalid(),
    );

    const result = await workflow.evaluate({
      currentStep: 'collect_email',
      submittedData: data,
      onboardingContext: { firstName: 'Ada' },
      onboardingId: 'onboarding-123',
    });

    expect(result.isTerminalInvalid()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
    expect(result.getAppliedStep()).toBe('collect_email');
    expect(result.getNextState()).toMatchObject({
      context: { firstName: 'Ada' },
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
    expect(data).toEqual({ email: 'person@example.com' });
    expect(connectorExecutionPort.execute).toHaveBeenCalledWith(
      definition.stepsByName.collect_email.connectors,
      { firstName: 'Ada', email: 'person@example.com' },
      { onboardingId: 'onboarding-123', stepName: 'collect_email' },
    );
  });

  it('awaits connector execution before returning a successful transition', async () => {
    let resolveExecution: ((value: ConnectorExecutionResult) => void) | undefined;
    const executionPromise = new Promise<ConnectorExecutionResult>((resolve) => {
      resolveExecution = resolve;
    });
    connectorExecutionPort.execute = jest.fn().mockReturnValue(executionPromise);
    workflow = new Workflow(definition, connectorExecutionPort);

    let settled = false;
    const evaluationPromise = workflow
      .evaluate({
        currentStep: 'collect_email',
        submittedData: { email: 'person@example.com' },
        onboardingContext: { alias: 'legacy' },
        onboardingId: 'onboarding-123',
      })
      .then((value) => {
        settled = true;
        return value;
      });

    await Promise.resolve();
    expect(connectorExecutionPort.execute).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveExecution?.(ConnectorExecutionResult.accepted());
    await expect(evaluationPromise).resolves.toEqual({
      acceptedData: { email: 'person@example.com' },
      appliedStep: 'collect_email',
      nextState: {
        context: { alias: 'legacy', email: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'accept_terms',
        completedAt: null,
        rejectionReason: null,
      },
    });
  });

  it('keeps non-final verifyCode invalid-data retryable without terminal next state', async () => {
    const otpWorkflow = new Workflow(
      validateAndNormalizeWorkflow({
        id: 'otp-invalid-data',
        version: 1,
        name: 'OTP Invalid Data',
        initial: 'verify_code',
        steps: [
          {
            name: 'verify_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'mock_email_otp',
                type: 'mock_email_otp',
                method: 'verifyCode',
                order: 1,
                fieldMapping: { code: 'verificationCode' },
                config: { maxAttempts: 3 },
              },
            ],
            transitions: [
              { status: 'success', target: 'approved' },
              { status: 'rejected', target: 'rejected' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest
          .fn()
          .mockResolvedValue(
            ConnectorExecutionResult.invalidData({ verificationCode: ['INVALID'] }),
          ),
      },
    );

    const result = await otpWorkflow.evaluate({
      currentStep: 'verify_code',
      submittedData: { verificationCode: '000000' },
      onboardingContext: { email: 'person@example.com' },
      onboardingId: 'onboarding-123',
    });

    expect(result.isRetryableInvalidData()).toBe(true);
    expect(result.getErrors()).toEqual({ verificationCode: ['INVALID'] });
    expect(result.getAppliedStep()).toBe('verify_code');
    expect(result.getNextState()).toBeUndefined();
  });

  it('routes accepted verifyCode outcome while scrubbing only mapped source fields', async () => {
    const execute = jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted());
    const otpWorkflow = new Workflow(
      validateAndNormalizeWorkflow({
        id: 'otp-accepted',
        version: 1,
        name: 'OTP Accepted',
        initial: 'verify_code',
        steps: [
          {
            name: 'verify_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
              notes: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'mock_email_otp',
                type: 'mock_email_otp',
                method: 'verifyCode',
                order: 1,
                fieldMapping: { code: 'verificationCode' },
                config: { maxAttempts: 3 },
              },
            ],
            transitions: [
              { status: 'success', target: 'approved' },
              { status: 'rejected', target: 'rejected' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      { execute },
    );

    await expect(
      otpWorkflow.evaluate({
        currentStep: 'verify_code',
        submittedData: { verificationCode: '123456', notes: 'keep-this' },
        onboardingContext: {
          email: 'person@example.com',
          code: 'legacy-code',
          journeyId: 'journey-1',
        },
        onboardingId: 'onboarding-123',
      }),
    ).resolves.toEqual({
      acceptedData: { notes: 'keep-this' },
      appliedStep: 'verify_code',
      nextState: {
        context: {
          email: 'person@example.com',
          code: 'legacy-code',
          journeyId: 'journey-1',
          notes: 'keep-this',
        },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
      },
    });

    expect(execute).toHaveBeenCalledWith(
      expect.any(Array),
      {
        email: 'person@example.com',
        code: 'legacy-code',
        journeyId: 'journey-1',
        verificationCode: '123456',
        notes: 'keep-this',
      },
      { onboardingId: 'onboarding-123', stepName: 'verify_code' },
    );

    const acceptedResult = await otpWorkflow.evaluate({
      currentStep: 'verify_code',
      submittedData: { verificationCode: '123456', notes: 'keep-this' },
      onboardingContext: {
        email: 'person@example.com',
        code: 'legacy-code',
        journeyId: 'journey-1',
      },
      onboardingId: 'onboarding-123',
    });
    expect(acceptedResult.getNextState()?.context.verificationCode).toBeUndefined();
  });

  it('routes rejected verifyCode outcome while preserving unrelated submitted and existing context fields', async () => {
    const otpWorkflow = new Workflow(
      validateAndNormalizeWorkflow({
        id: 'otp-rejected',
        version: 1,
        name: 'OTP Rejected',
        initial: 'verify_code',
        steps: [
          {
            name: 'verify_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
              notes: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'mock_email_otp',
                type: 'mock_email_otp',
                method: 'verifyCode',
                order: 1,
                fieldMapping: { code: 'verificationCode' },
                config: { maxAttempts: 3 },
              },
            ],
            transitions: [
              { status: 'success', target: 'approved' },
              { status: 'rejected', target: 'rejected' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest
          .fn()
          .mockResolvedValue(ConnectorExecutionResult.rejected('ATTEMPTS_EXHAUSTED')),
      },
    );

    const result = await otpWorkflow.evaluate({
      currentStep: 'verify_code',
      submittedData: { verificationCode: '000000', notes: 'keep-on-reject' },
      onboardingContext: {
        email: 'person@example.com',
        code: 'legacy-code',
        journeyId: 'journey-1',
      },
      onboardingId: 'onboarding-123',
    });

    expect(result).toEqual({
      acceptedData: { notes: 'keep-on-reject' },
      appliedStep: 'verify_code',
      nextState: {
        context: {
          email: 'person@example.com',
          code: 'legacy-code',
          journeyId: 'journey-1',
          notes: 'keep-on-reject',
        },
        status: 'rejected',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: 'ATTEMPTS_EXHAUSTED',
      },
    });
    expect(result.isRejected()).toBe(true);
    expect(result.getRejectionReason()).toBe('ATTEMPTS_EXHAUSTED');
    expect(result.getNextState()?.context.verificationCode).toBeUndefined();
  });

  it('defaults missing invalid-data errors to an empty object for retryable verify-code outcomes', async () => {
    const otpWorkflow = new Workflow(
      validateAndNormalizeWorkflow({
        id: 'otp-missing-invalid-data-errors',
        version: 1,
        name: 'OTP Missing Invalid Data Errors',
        initial: 'verify_code',
        steps: [
          {
            name: 'verify_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'mock_email_otp',
                type: 'mock_email_otp',
                method: 'verifyCode',
                order: 1,
                fieldMapping: { code: 'verificationCode' },
                config: { maxAttempts: 3 },
              },
            ],
            transitions: [
              { status: 'success', target: 'approved' },
              { status: 'rejected', target: 'rejected' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest.fn().mockResolvedValue({
          isAccepted: () => false,
          isInvalid: () => false,
          isInvalidData: () => true,
          isRejected: () => false,
        } as unknown as ConnectorExecutionResult),
      },
    );

    const result = await otpWorkflow.evaluate({
      currentStep: 'verify_code',
      submittedData: { verificationCode: '000000' },
      onboardingContext: { email: 'person@example.com' },
      onboardingId: 'onboarding-123',
    });

    expect(result.isRetryableInvalidData()).toBe(true);
    expect(result.getErrors()).toEqual({});
    expect(result.getAppliedStep()).toBe('verify_code');
    expect(result.getNextState()).toBeUndefined();
  });

  it('defaults missing rejection reason to CONNECTOR_REJECTED and preserves rejected transition behavior', async () => {
    const otpWorkflow = new Workflow(
      validateAndNormalizeWorkflow({
        id: 'otp-missing-rejection-reason',
        version: 1,
        name: 'OTP Missing Rejection Reason',
        initial: 'verify_code',
        steps: [
          {
            name: 'verify_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'mock_email_otp',
                type: 'mock_email_otp',
                method: 'verifyCode',
                order: 1,
                fieldMapping: { code: 'verificationCode' },
                config: { maxAttempts: 3 },
              },
            ],
            transitions: [{ status: 'rejected', target: 'rejected' }],
          },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest.fn().mockResolvedValue({
          isAccepted: () => false,
          isInvalid: () => false,
          isInvalidData: () => false,
          isRejected: () => true,
          reason: undefined,
        } as unknown as ConnectorExecutionResult),
      },
    );

    const result = await otpWorkflow.evaluate({
      currentStep: 'verify_code',
      submittedData: { verificationCode: '000000' },
      onboardingContext: { email: 'person@example.com' },
      onboardingId: 'onboarding-123',
    });

    expect(result.isRejected()).toBe(true);
    expect(result.getRejectionReason()).toBe('CONNECTOR_REJECTED');
    expect(result.getNextState()).toMatchObject({
      status: 'rejected',
      rejectionReason: 'CONNECTOR_REJECTED',
    });
  });

  it('propagates connector execution faults without converting them to workflow results', async () => {
    const connectorExecutionPort = {
      execute: jest.fn().mockRejectedValue(new Error('connector exploded')),
    } as unknown as ConnectorExecutionPort;
    const workflowWithFault = new Workflow(
      validateAndNormalizeWorkflow({
        id: 'fault-propagation',
        version: 1,
        name: 'Fault Propagation',
        initial: 'collect_email',
        steps: [
          {
            name: 'collect_email',
            status: 'awaiting_user',
            data: {
              email: {
                type: 'text',
                required: true,
                validation: { format: 'email' },
              },
            },
            transitions: [{ status: 'success', target: 'approved' }],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
        ],
      }),
      connectorExecutionPort,
    );

    await expect(
      workflowWithFault.evaluate({
        currentStep: 'collect_email',
        submittedData: { email: 'person@example.com' },
        onboardingContext: {},
        onboardingId: 'onboarding-123',
      }),
    ).rejects.toThrow('connector exploded');
  });

  it('returns invalid UNKNOWN_STATE when success transition is missing for accepted connector output', async () => {
    const invalidWorkflow = new Workflow(
      validateAndNormalizeWorkflow({
        id: 'missing-success',
        version: 1,
        name: 'Missing Success',
        initial: 'collect_email',
        steps: [
          {
            name: 'collect_email',
            status: 'awaiting_user',
            data: {
              email: {
                type: 'text',
                required: true,
                validation: { format: 'email' },
              },
            },
            transitions: [{ status: 'rejected', target: 'rejected' }],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
      },
    );

    const result = await invalidWorkflow.evaluate({
      currentStep: 'collect_email',
      submittedData: { email: 'person@example.com' },
      onboardingContext: { persisted: true },
      onboardingId: 'onboarding-123',
    });

    expect(result.isTerminalInvalid()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
    expect(result.getAppliedStep()).toBe('collect_email');
    expect(result.getNextState()).toMatchObject({
      context: { persisted: true },
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
  });

  it('returns invalid UNKNOWN_STATE when rejected transition is missing for rejected connector output', async () => {
    const invalidWorkflow = new Workflow(
      validateAndNormalizeWorkflow({
        id: 'missing-rejected',
        version: 1,
        name: 'Missing Rejected',
        initial: 'verify_code',
        steps: [
          {
            name: 'verify_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            transitions: [{ status: 'success', target: 'approved' }],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest
          .fn()
          .mockResolvedValue(ConnectorExecutionResult.rejected('CONNECTOR_REJECTED')),
      },
    );

    const result = await invalidWorkflow.evaluate({
      currentStep: 'verify_code',
      submittedData: { verificationCode: '000000' },
      onboardingContext: { persisted: true },
      onboardingId: 'onboarding-123',
    });

    expect(result.isTerminalInvalid()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
    expect(result.getAppliedStep()).toBe('verify_code');
    expect(result.getNextState()).toMatchObject({
      context: { persisted: true },
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
  });
});
