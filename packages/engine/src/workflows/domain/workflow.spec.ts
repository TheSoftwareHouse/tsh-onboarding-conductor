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
    const result = await workflow.evaluate({
      currentStep: 'collect_email',
      submittedData: data,
    });

    expect(result).toEqual({
      acceptedData: { email: 'person@example.com' },
      appliedStep: 'collect_email',
      status: 'awaiting_user',
      currentStep: 'accept_terms',
      terminal: false,
    });
    expect(result).toBeDefined();
    expect(result?.acceptedData).not.toBe(data);
    expect(data).toEqual({ email: 'person@example.com' });
    expect(connectorExecutionPort.execute).toHaveBeenCalledWith(
      definition.stepsByName.collect_email.connectors,
      { email: 'person@example.com' },
    );
    expect((connectorExecutionPort.execute as jest.Mock).mock.calls[0][1]).not.toBe(data);
    expect((connectorExecutionPort.execute as jest.Mock).mock.calls[0][1]).not.toBe(
      result?.acceptedData,
    );

    if (result) {
      (result.acceptedData.email as string) = 'changed@example.com';
    }
    expect(data).toEqual({ email: 'person@example.com' });
  });

  it('resolves terminal state from target metadata', async () => {
    await expect(
      workflow.evaluate({
        currentStep: 'accept_terms',
        submittedData: { acceptedTerms: true },
      }),
    ).resolves.toEqual({
      acceptedData: { acceptedTerms: true },
      appliedStep: 'accept_terms',
      status: 'approved',
      currentStep: null,
      terminal: true,
    });
    expect(connectorExecutionPort.execute).toHaveBeenCalledWith(
      definition.stepsByName.accept_terms.connectors,
      { acceptedTerms: true },
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
      status: 'approved',
      currentStep: null,
      terminal: true,
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
    });

    expect(result).toEqual({
      acceptedData: {
        approved: false,
        retries: 0,
        note: '',
      },
      appliedStep: 'collect_data',
      status: 'approved',
      currentStep: null,
      terminal: true,
    });
    expect(submittedData).toEqual({
      approved: false,
      retries: 0,
      note: '',
    });

    if (result) {
      (result.acceptedData.note as string) = 'updated';
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
      }),
    ).resolves.toBeUndefined();
    expect(data).toEqual({ email: 'person@example.com' });
  });
});
