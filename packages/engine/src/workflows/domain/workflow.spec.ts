import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
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
      execute: jest.fn().mockResolvedValue(true),
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
      (result.nextState.context.email as string) = 'changed@example.com';
    }
    expect(data).toEqual({ email: 'person@example.com' });
    expect(onboardingContext).toEqual({ firstName: 'Ada' });
  });

  it('returns undefined for a file step when connector execution rejects the reference', async () => {
    const connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(false),
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

    await expect(
      fileWorkflow.evaluate({
        currentStep: 'collect_identity',
        submittedData: { identityDocument: 'document-123' },
        onboardingContext: {},
        onboardingId: 'onboarding-123',
      }),
    ).resolves.toBeUndefined();
  });

  it('preserves the file-step transition when connector execution accepts the reference', async () => {
    const connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(true),
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
      },
    });
    const evaluation = await workflow.evaluate({
      currentStep: 'accept_terms',
      submittedData: { acceptedTerms: true },
      onboardingContext: { email: 'person@example.com' },
      onboardingId: 'onboarding-123',
    });
    expect(evaluation?.nextState.completedAt).toBeInstanceOf(Date);
    expect((evaluation?.nextState.completedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(connectorExecutionPort.execute).toHaveBeenCalledWith(
      definition.stepsByName.accept_terms.connectors,
      { email: 'person@example.com', acceptedTerms: true },
      { onboardingId: 'onboarding-123', stepName: 'accept_terms' },
    );
  });

  it.each([
    ['missing field', 'collect_email', {}],
    ['undeclared field', 'collect_email', { other: 'value' }],
    ['wrong type', 'collect_email', { email: 42 }],
    ['invalid email', 'collect_email', { email: 'invalid' }],
    ['false const', 'accept_terms', { acceptedTerms: false }],
    ['terminal step', 'approved', {}],
    ['malformed body', 'collect_email', null],
    ['array body', 'collect_email', []],
  ])('returns undefined for %s runtime input', async (_description, currentStep, submittedData) => {
    await expect(
      workflow.evaluate({
        currentStep,
        submittedData,
        onboardingContext: {},
        onboardingId: 'onboarding-123',
      }),
    ).resolves.toBeUndefined();
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
      },
    });
    expect(submittedData).toEqual({
      approved: false,
      retries: 0,
      note: '',
    });

    if (result) {
      (result.nextState.context.note as string) = 'updated';
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
      await expect(
        fileWorkflow.evaluate({
          currentStep: 'collect_data',
          submittedData: clone,
          onboardingContext: {},
          onboardingId: 'onboarding-123',
        }),
      ).resolves.toBeUndefined();
      expect(clone).toEqual(submittedData);
    }
  });

  it('rejects an unknown server-held current step without mutating the body', async () => {
    const data = { email: 'person@example.com' };

    await expect(
      workflow.evaluate({
        currentStep: 'missing-step',
        submittedData: data,
        onboardingContext: {},
        onboardingId: 'onboarding-123',
      }),
    ).resolves.toBeUndefined();
    expect(data).toEqual({ email: 'person@example.com' });
    expect(connectorExecutionPort.execute).not.toHaveBeenCalled();
  });

  it('returns undefined when connector execution rejects the transition', async () => {
    const data = { email: 'person@example.com' };
    (connectorExecutionPort.execute as jest.Mock).mockResolvedValueOnce(false);

    await expect(
      workflow.evaluate({
        currentStep: 'collect_email',
        submittedData: data,
        onboardingContext: { firstName: 'Ada' },
        onboardingId: 'onboarding-123',
      }),
    ).resolves.toBeUndefined();
    expect(data).toEqual({ email: 'person@example.com' });
    expect(connectorExecutionPort.execute).toHaveBeenCalledWith(
      definition.stepsByName.collect_email.connectors,
      { firstName: 'Ada', email: 'person@example.com' },
      { onboardingId: 'onboarding-123', stepName: 'collect_email' },
    );
  });

  it('awaits connector execution before returning a successful transition', async () => {
    let resolveExecution: ((value: boolean) => void) | undefined;
    const executionPromise = new Promise<boolean>((resolve) => {
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

    resolveExecution?.(true);
    await expect(evaluationPromise).resolves.toEqual({
      acceptedData: { email: 'person@example.com' },
      appliedStep: 'collect_email',
      nextState: {
        context: { alias: 'legacy', email: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'accept_terms',
        completedAt: null,
      },
    });
  });
});
