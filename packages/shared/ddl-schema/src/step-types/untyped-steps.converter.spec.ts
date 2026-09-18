import { compileWorkflow } from './workflow.compiler';
import { convertUntypedSteps } from './untyped-steps.converter';
import type { CompiledWorkflowDefinition, RawWorkflowField } from '../workflow-contract';
import { validateAndNormalizeWorkflow } from '../workflow-validator';

const stepDocument: CompiledWorkflowDefinition = {
  id: 'legacy',
  version: 3,
  initial: 'collect_email',
  webhook: { notify: { path: 'notify' } },
  scoring: { risk: { min: 0, max: 100 } },
  steps: [
    {
      name: 'collect_email',
      status: 'awaiting_user',
      data: {
        // Declared out of alphabetical order on purpose: the order is what a client renders.
        zip: { type: 'text', required: false },
        email: {
          type: 'text',
          required: true,
          validation: { format: 'email' },
        } as RawWorkflowField,
      },
      connectors: [
        {
          name: 'check',
          id: 'mock_kyc_1',
          type: 'kyc',
          order: 1,
          fieldMapping: { email: 'email' },
        },
      ],
      scoring: [{ score: 'risk', when: { field: 'zip', isSet: true }, add: 5 }],
      transitions: [
        { status: 'success', when: { score: 'risk', gte: 5 }, target: 'review' },
        { status: 'success', target: 'approved', webhook: { notify: false } },
      ],
    },
    {
      name: 'review',
      status: 'awaiting_manual_review',
      data: {},
      transitions: [
        { status: 'success' },
        { status: 'manual.approve', target: 'approved' },
        { status: 'manual.reject', target: 'rejected' },
      ],
    },
    { name: 'approved', status: 'approved', data: {}, transitions: [] },
    { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
  ],
};

describe('convertUntypedSteps', () => {
  it('turns every untyped step into a `custom` step carrying it verbatim, and keeps the root as it was', () => {
    const converted = convertUntypedSteps(stepDocument);

    expect(Object.keys(converted)).toEqual([
      'id',
      'version',
      'initial',
      'webhook',
      'scoring',
      'steps',
    ]);
    expect(converted.steps.map((step) => step.type)).toEqual(Array(4).fill('custom'));
    expect(converted.steps[0]).toEqual({
      name: 'collect_email',
      type: 'custom',
      config: {
        status: stepDocument.steps[0].status,
        data: stepDocument.steps[0].data,
        connectors: stepDocument.steps[0].connectors,
        scoring: stepDocument.steps[0].scoring,
        transitions: stepDocument.steps[0].transitions,
      },
    });
  });

  it('compiles back to exactly the steps it was given, in order, key order included', () => {
    const compiled = compileWorkflow(convertUntypedSteps(stepDocument));

    expect(JSON.stringify(compiled)).toBe(JSON.stringify(stepDocument));
  });

  it('is the document the engine loads: it normalizes, and the refusal rule still sees a rejected terminal', () => {
    const normalized = validateAndNormalizeWorkflow(convertUntypedSteps(stepDocument));

    expect(normalized.initial).toBe('collect_email');
    expect(Object.keys(normalized.stepsByName.collect_email.data)).toEqual(['zip', 'email']);
    expect(normalized.stepsByName.collect_email.transitions[1].webhook).toEqual({ notify: false });
    expect(normalized.stepsByName.rejected.terminal).toBe(true);
  });

  it('carries a step that is not an object through, so the schema refuses it where it sits', () => {
    const converted = convertUntypedSteps({
      ...stepDocument,
      steps: [
        stepDocument.steps[2],
        'not a step' as unknown as CompiledWorkflowDefinition['steps'][0],
      ],
    });

    expect(() => compileWorkflow(converted)).toThrow(
      expect.objectContaining({ reason: 'INVALID_SHAPE', path: 'steps[1]' }),
    );
  });
});
