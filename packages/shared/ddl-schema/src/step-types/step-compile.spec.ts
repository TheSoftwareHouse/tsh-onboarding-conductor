import type { RawWorkflowStep } from '../workflow-contract';
import { WorkflowInvalidError } from '../workflow-invalid.error';
import { resolveStep, tryCompileStep, tryResolveStep, type ResolvedStep } from './step-compile';

const formStep: RawWorkflowStep = {
  name: 'details',
  type: 'form',
  config: { fields: { fullName: { type: 'text', required: true } } },
};

const contactStep: RawWorkflowStep = {
  name: 'contact',
  type: 'contact-details',
  config: { email: 'omitted' },
};

const otpStep: RawWorkflowStep = {
  name: 'phone',
  type: 'otp-verify',
  config: { channel: 'sms', connector: { id: 'otp' } },
};

const resolved = (step: RawWorkflowStep, index = 0): ResolvedStep => resolveStep(step, index);

describe('step-compile', () => {
  it('compiles one valid step to the steps it owns', () => {
    const outcome = tryCompileStep(resolved(formStep), [resolved(formStep)], new Set());

    expect(outcome.kind).toBe('compiled');
    expect(outcome.kind === 'compiled' && outcome.steps.map((step) => step.name)).toEqual([
      'details',
    ]);
    expect(outcome.kind === 'compiled' && Object.keys(outcome.steps[0].data)).toEqual(['fullName']);
  });

  it('points a wired port at a token and leaves an unwired one undefined', () => {
    const wired = tryCompileStep(resolved(formStep), [resolved(formStep)], new Set(['success']));
    const unwired = tryCompileStep(resolved(formStep), [resolved(formStep)], new Set());

    expect(wired.kind === 'compiled' && wired.steps[0].transitions[0].target).toContain('success');
    expect(unwired.kind === 'compiled' && unwired.steps[0].transitions[0].target).toBeUndefined();
  });

  it('reports a step that fails to resolve as its own failure, with its path', () => {
    const outcome = tryResolveStep({ name: 'broken', type: 'form', config: { fields: 'nope' } }, 3);

    expect(outcome.kind).toBe('failed');
    expect(outcome.kind === 'failed' && outcome.error).toBeInstanceOf(WorkflowInvalidError);
    expect(outcome.kind === 'failed' && (outcome.error as WorkflowInvalidError).path).toBe(
      'steps[3].config',
    );
  });

  it('reports a step that fails to compile as its own failure, with its path', () => {
    const phone = resolved(otpStep, 1);
    const outcome = tryCompileStep(phone, [phone], new Set());

    expect(outcome.kind).toBe('failed');
    expect(outcome.kind === 'failed' && (outcome.error as WorkflowInvalidError).path).toBe(
      'steps[1]',
    );
  });

  it('compiles a step that reads a field an earlier step publishes', () => {
    const contact = resolved(contactStep, 0);
    const phone = resolved(otpStep, 1);
    const outcome = tryCompileStep(phone, [contact, phone], new Set());

    expect(outcome.kind).toBe('compiled');
    expect(outcome.kind === 'compiled' && outcome.steps.map((step) => step.name)).toEqual([
      'phone',
      'phone_verify',
      'phone_resend',
    ]);
  });
});
