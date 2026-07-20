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

  beforeEach(() => {
    connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(undefined),
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
    });

    expect(result).toEqual({
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

  it('resolves terminal state with completedAt from target metadata', async () => {
    const before = Date.now();
    await expect(
      workflow.evaluate({
        currentStep: 'accept_terms',
        submittedData: { acceptedTerms: true },
        onboardingContext: { email: 'person@example.com' },
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
    });
    expect(evaluation?.nextState.completedAt).toBeInstanceOf(Date);
    expect((evaluation?.nextState.completedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(connectorExecutionPort.execute).toHaveBeenCalledWith(
      definition.stepsByName.accept_terms.connectors,
      { email: 'person@example.com', acceptedTerms: true },
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
    });

    expect(result).toEqual({
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
    });

    expect(result).toEqual({
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

  it('rejects an unknown server-held current step without mutating the body', async () => {
    const data = { email: 'person@example.com' };

    await expect(
      workflow.evaluate({
        currentStep: 'missing-step',
        submittedData: data,
        onboardingContext: {},
      }),
    ).resolves.toBeUndefined();
    expect(data).toEqual({ email: 'person@example.com' });
    expect(connectorExecutionPort.execute).not.toHaveBeenCalled();
  });

  it('awaits connector execution before returning a successful transition', async () => {
    let resolveExecution: (() => void) | undefined;
    const executionPromise = new Promise<void>((resolve) => {
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
      })
      .then((value) => {
        settled = true;
        return value;
      });

    await Promise.resolve();
    expect(connectorExecutionPort.execute).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveExecution?.();
    await expect(evaluationPromise).resolves.toEqual({
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
