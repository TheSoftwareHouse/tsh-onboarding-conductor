import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
import baseWorkflowConfig from './base-workflow.config.json';
import { Workflow } from './workflow';

describe('Workflow', () => {
  const definition = validateAndNormalizeWorkflow(baseWorkflowConfig);
  let workflow: Workflow;

  beforeEach(() => {
    workflow = new Workflow(definition);
  });

  it('initializes from normalized workflow metadata', () => {
    expect(workflow.initialize()).toEqual({
      workflowId: 'base',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: 'collect_email',
    });
  });

  it('validates fields and resolves the declared non-terminal target', () => {
    const data = { email: 'person@example.com' };
    const result = workflow.evaluate({
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

    if (result) {
      (result.acceptedData.email as string) = 'changed@example.com';
    }
    expect(data).toEqual({ email: 'person@example.com' });
  });

  it('resolves terminal state from target metadata', () => {
    expect(
      workflow.evaluate({
        currentStep: 'accept_terms',
        submittedData: { acceptedTerms: true },
      }),
    ).toEqual({
      acceptedData: { acceptedTerms: true },
      appliedStep: 'accept_terms',
      status: 'approved',
      currentStep: null,
      terminal: true,
    });
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
  ])('returns undefined for %s runtime input', (_description, currentStep, submittedData) => {
    expect(
      workflow.evaluate({
        currentStep,
        submittedData,
      }),
    ).toBeUndefined();
  });

  it('rejects an unknown server-held current step without mutating the body', () => {
    const data = { email: 'person@example.com' };

    expect(
      workflow.evaluate({
        currentStep: 'missing-step',
        submittedData: data,
      }),
    ).toBeUndefined();
    expect(data).toEqual({ email: 'person@example.com' });
  });
});
