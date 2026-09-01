import { validateAndNormalizeWorkflow, WorkflowInvalidError } from '../workflow-validator';

type TransitionFixture = Record<string, unknown>;

const buildWorkflow = (transitions: TransitionFixture[]) => ({
  id: 'exhaustive',
  version: 1,
  name: 'Exhaustive',
  initial: 'choose',
  steps: [
    {
      name: 'choose',
      status: 'awaiting_user',
      data: { pick: { type: 'text', required: true, validation: { oneOf: ['LEFT', 'RIGHT'] } } },
      transitions,
    },
    { name: 'left', status: 'awaiting_user', data: {}, transitions: [{ status: 'success' }] },
    { name: 'right', status: 'awaiting_user', data: {}, transitions: [{ status: 'success' }] },
  ],
});

const LEFT = { status: 'success', when: { field: 'pick', equals: 'LEFT' }, target: 'left' };
const RIGHT = { status: 'success', when: { field: 'pick', equals: 'RIGHT' }, target: 'right' };
const FALLBACK = { status: 'success', target: 'right' };

describe('an exhaustive success group', () => {
  it('needs no unconditional fallback when every arm names its condition', () => {
    const definition = validateAndNormalizeWorkflow(buildWorkflow([LEFT, RIGHT]));

    expect(definition.stepsByName.choose.transitions).toHaveLength(2);
    expect(
      definition.stepsByName.choose.transitions.every(
        (transition) => transition.when !== undefined,
      ),
    ).toBe(true);
  });

  it('still accepts a fallback, which is how a document opts out of ending invalid', () => {
    const definition = validateAndNormalizeWorkflow(buildWorkflow([LEFT, FALLBACK]));

    expect(definition.stepsByName.choose.transitions[1].when).toBeUndefined();
  });

  it('still refuses two unconditional arms of the same status', () => {
    expect(() =>
      validateAndNormalizeWorkflow(
        buildWorkflow([FALLBACK, { status: 'success', target: 'left' }]),
      ),
    ).toThrow(WorkflowInvalidError);
  });

  it('still refuses a fallback that is not last, which would shadow the arms after it', () => {
    expect(() => validateAndNormalizeWorkflow(buildWorkflow([FALLBACK, LEFT]))).toThrow(
      WorkflowInvalidError,
    );
  });
});
