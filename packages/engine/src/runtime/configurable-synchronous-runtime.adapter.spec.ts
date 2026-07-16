import { ConfigurableSynchronousRuntimeAdapter } from './configurable-synchronous-runtime.adapter';
import { WorkflowNotFoundError } from './onboarding-runtime.port';
import { testWorkflowRegistry } from './fixtures/test-workflow.registry';

describe('ConfigurableSynchronousRuntimeAdapter', () => {
  let adapter: ConfigurableSynchronousRuntimeAdapter;

  beforeEach(() => {
    adapter = new ConfigurableSynchronousRuntimeAdapter(testWorkflowRegistry);
  });

  it('initializes from the normalized workflow metadata', () => {
    expect(adapter.initialize({ workflowId: 'passport-check', workflowVersion: 3 })).toEqual(
      expect.objectContaining({
        success: true,
        workflowId: 'passport-check',
        workflowVersion: 3,
        appliedStep: 'capture_alias',
        targetState: { status: 'awaiting_user', currentStep: 'capture_alias' },
        terminal: false,
      }),
    );
  });

  it('validates fields and resolves the declared non-terminal target', () => {
    const data = { contactAddress: 'person@example.com' };
    const result = adapter.evaluate({
      workflowId: 'passport-check',
      workflowVersion: 3,
      currentStep: 'capture_alias',
      submittedData: data,
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        acceptedData: { contactAddress: 'person@example.com' },
        appliedStep: 'capture_alias',
        targetState: { status: 'awaiting_user', currentStep: 'confirm_identity' },
        terminal: false,
      }),
    );
    expect(result).not.toBe(data);
    expect((result as { acceptedData: Record<string, unknown> }).acceptedData).not.toBe(data);
    expect(data).toEqual({ contactAddress: 'person@example.com' });

    ((result as { acceptedData: Record<string, unknown> }).acceptedData.contactAddress as string) =
      'changed@example.com';
    expect(data).toEqual({ contactAddress: 'person@example.com' });
  });

  it('resolves terminal state from target metadata', () => {
    expect(
      adapter.evaluate({
        workflowId: 'passport-check',
        workflowVersion: 3,
        currentStep: 'confirm_identity',
        submittedData: { identityConfirmed: true },
      }),
    ).toEqual(
      expect.objectContaining({
        success: true,
        acceptedData: { identityConfirmed: true },
        appliedStep: 'confirm_identity',
        targetState: { status: 'approved', currentStep: null },
        terminal: true,
      }),
    );
  });

  it.each([
    ['missing field', 'capture_alias', {}],
    ['undeclared field', 'capture_alias', { other: 'value' }],
    ['wrong type', 'capture_alias', { contactAddress: 42 }],
    ['invalid email', 'capture_alias', { contactAddress: 'invalid' }],
    ['false const', 'confirm_identity', { identityConfirmed: false }],
    ['terminal step', 'cleared', {}],
    ['malformed body', 'capture_alias', null],
    ['array body', 'capture_alias', []],
  ])('rejects %s as invalid runtime input', (_description, currentStep, submittedData) => {
    expect(
      adapter.evaluate({
        workflowId: 'passport-check',
        workflowVersion: 3,
        currentStep,
        submittedData,
      }),
    ).toEqual({ success: false, code: 'INVALID_STEP_DATA', acceptedData: {} });
  });

  it('rejects an unknown server-held current step without mutating the body', () => {
    const data = { contactAddress: 'person@example.com' };
    expect(
      adapter.evaluate({
        workflowId: 'passport-check',
        workflowVersion: 3,
        currentStep: 'missing-step',
        submittedData: data,
      }),
    ).toEqual({ success: false, code: 'INVALID_STEP_DATA', acceptedData: {} });
    expect(data).toEqual({ contactAddress: 'person@example.com' });
  });

  it('distinguishes unknown workflow configuration from invalid input', () => {
    expect(() => adapter.initialize({ workflowId: 'missing', workflowVersion: 3 })).toThrow(
      WorkflowNotFoundError,
    );
  });
});
