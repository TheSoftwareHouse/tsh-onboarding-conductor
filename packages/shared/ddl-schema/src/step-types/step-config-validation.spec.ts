import { compileWorkflow } from './workflow.compiler';
import type { RawWorkflowStep } from '../workflow-contract';
import { WorkflowInvalidError } from '../workflow-invalid.error';
import type { CompiledWorkflowStep } from '../workflow-contract';

const terminal = (name: string, outcome = 'approved'): RawWorkflowStep => ({
  name,
  type: 'terminal',
  config: { outcome },
});

const compileOne = (step: RawWorkflowStep): CompiledWorkflowStep => {
  const compiled = compileWorkflow({
    id: 'one',
    version: 1,
    steps: [step, terminal('done')],
  });

  return compiled.steps[0];
};

/**
 * Every config a step type must refuse. These are the guardrails a drag-and-drop builder leans on:
 * it can offer any combination of values its config form allows, so a combination that would
 * compile into a broken workflow has to fail at load with a reason rather than reach an onboarding.
 */
const expectRejected = (step: RawWorkflowStep): void => {
  expect(() => compileOne(step)).toThrow(WorkflowInvalidError);
};

describe('notify', () => {
  it('keys the destination on the payload key every delivery adapter reads', () => {
    const step = compileOne({
      name: 'tell',
      type: 'notify',
      config: {
        connector: {
          id: 'sendgrid_email',
          type: 'email_delivery',
          fieldMapping: {
            templateId: 'emailTemplateId',
            'dynamicTemplateData.first_name': 'firstName',
          },
        },
        recipientField: 'email',
      },
      include: [
        {
          type: 'form',
          config: {
            fields: {
              email: { type: 'text', required: true },
              emailTemplateId: { type: 'text', required: true },
              firstName: { type: 'text', required: true },
            },
          },
        },
      ],
      edges: { success: 'done' },
    });

    expect(step.connectors?.[0]).toEqual({
      name: 'sendgrid_email',
      id: 'sendgrid_email',
      type: 'email_delivery',
      order: 1,
      fieldMapping: {
        recipient: 'email',
        templateId: 'emailTemplateId',
        'dynamicTemplateData.first_name': 'firstName',
      },
    });
    expect(step.transitions).toEqual([{ status: 'success', target: 'done' }]);
  });

  it('refuses a second source for the recipient, which could disagree with the first', () => {
    expectRejected({
      name: 'tell',
      type: 'notify',
      config: {
        connector: {
          id: 'sendgrid_email',
          type: 'email_delivery',
          fieldMapping: { recipient: 'somethingElse' },
        },
        recipientField: 'email',
      },
      include: [{ type: 'form', config: { fields: { email: { type: 'text', required: true } } } }],
      edges: { success: 'done' },
    });
  });
});

describe('wait-for-external', () => {
  it('collects what another system supplies and moves on when it arrives', () => {
    const step = compileOne({
      name: 'await_account',
      type: 'wait-for-external',
      config: {
        fields: {
          userId: { type: 'text', required: true, validation: { minLength: 1, maxLength: 100 } },
        },
      },
      edges: { received: 'done' },
    });

    expect(step).toEqual({
      name: 'await_account',
      status: 'awaiting_user',
      data: {
        userId: { type: 'text', required: true, validation: { minLength: 1, maxLength: 100 } },
      },
      // The port is `received`, but it compiles to the same arm any single outcome does.
      transitions: [{ status: 'success', target: 'done' }],
    });
  });
});

describe('form', () => {
  it('lets a hand-written field claim a canonical role a downstream step reads', () => {
    const compiled = compileWorkflow({
      id: 'canonical',
      version: 1,
      steps: [
        {
          name: 'contact',
          type: 'form',
          config: {
            fields: {
              workEmail: { type: 'text', required: true, validation: { format: 'email' } },
            },
            canonical: { email: 'workEmail' },
          },
          edges: { success: 'done' },
        },
        terminal('done'),
      ],
    });

    expect(Object.keys(compiled.steps[0].data)).toEqual(['workEmail']);
  });

  it('refuses a role pointing at a field it does not declare', () => {
    expectRejected({
      name: 'contact',
      type: 'form',
      config: {
        fields: { workEmail: { type: 'text', required: true } },
        canonical: { email: 'personalEmail' },
      },
      edges: { success: 'done' },
    });
  });
});

describe('config guardrails', () => {
  it('refuses an unknown country preset and a malformed explicit list', () => {
    expectRejected({
      name: 'where',
      type: 'address',
      config: { countries: 'eu-plus-switzerland' },
      edges: { success: 'done' },
    });
    expectRejected({
      name: 'where',
      type: 'address',
      config: { countries: ['fra'] },
      edges: { success: 'done' },
    });
  });

  it('refuses an age range that no applicant could satisfy', () => {
    expectRejected({
      name: 'who',
      type: 'identity-profile',
      config: { nationalities: ['FR'], minAgeYears: 120, maxAgeYears: 18 },
      edges: { success: 'done' },
    });
  });

  it('refuses an unknown questionnaire section and a repeated one', () => {
    expectRejected({
      name: 'ask',
      type: 'questionnaire',
      config: { sections: ['crypto_experience'] },
      edges: { success: 'done' },
    });
    expectRejected({
      name: 'ask',
      type: 'questionnaire',
      config: { sections: ['purpose', 'purpose'] },
      edges: { success: 'done' },
    });
  });

  it('refuses a duplicated consent key, which would collide on its own field names', () => {
    expectRejected({
      name: 'agree',
      type: 'consents',
      config: { consents: [{ key: 'terms' }, { key: 'terms', version: '2026-01-01' }] },
      edges: { success: 'done' },
    });
  });

  it('refuses a duplicated document type in one choice', () => {
    expectRejected({
      name: 'pick',
      type: 'document-choice',
      config: {
        documents: [
          { type: 'PASSPORT', countries: ['FR'] },
          { type: 'PASSPORT', countries: ['DE'] },
        ],
      },
      edges: { PASSPORT: 'done' },
    });
  });

  it('refuses an upload content type that is not a media type, and a non-positive size cap', () => {
    expectRejected({
      name: 'doc',
      type: 'document-capture',
      config: { document: 'PASSPORT', contentTypes: ['a picture'] },
      edges: { success: 'done' },
    });
    expectRejected({
      name: 'doc',
      type: 'document-capture',
      config: { document: 'PASSPORT', maxSizeBytes: 0 },
      edges: { success: 'done' },
    });
  });

  it('refuses a resend reason that is not a refusal the executor can report', () => {
    expectRejected({
      name: 'phone',
      type: 'otp-verify',
      config: {
        channel: 'sms',
        recipientField: 'phoneNumber',
        connector: { id: 'twilio_verify' },
        resendReasons: ['TOO_SLOW'],
      },
      edges: { verified: 'done', refused: 'done' },
    });
  });

  it('refuses two comparators on one score band, an interval written as a bound', () => {
    expectRejected({
      name: 'assess',
      type: 'risk-score',
      config: {
        rules: [{ score: 'risk', add: 10 }],
        bands: [{ port: 'medium', score: 'risk', gte: 20, lt: 60 }],
      },
      edges: { medium: 'done' },
    });
  });

  it('refuses a branch or band claiming the catch-all port name', () => {
    expectRejected({
      name: 'branch',
      type: 'decision',
      config: { branches: [{ port: 'default', when: { field: 'a', isSet: true } }] },
      include: [{ type: 'form', config: { fields: { a: { type: 'text', required: true } } } }],
      edges: { default: 'done' },
    });
  });

  it('refuses an http-call with no request to make', () => {
    expectRejected({
      name: 'call',
      type: 'http-call',
      config: { request: {} },
      edges: { success: 'done' },
    });
  });

  it('refuses an unknown terminal outcome', () => {
    expectRejected({ name: 'stop', type: 'terminal', config: { outcome: 'abandoned' } });
  });
});
