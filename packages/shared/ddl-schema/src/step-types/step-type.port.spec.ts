import { validateAndNormalizeWorkflow } from '../workflow-validator';
import type { RawWorkflowStep } from '../workflow-contract';

const workflowWith = (fields: Record<string, unknown>) =>
  validateAndNormalizeWorkflow({
    id: 'client-visible',
    version: 1,
    steps: [
      {
        name: 'collect',
        type: 'form',
        config: { fields },
        edges: { success: 'done' },
      },
      { name: 'done', type: 'terminal', config: { outcome: 'approved' } },
    ] as RawWorkflowStep[],
  });

describe('clientVisible on a built field', () => {
  it('survives normalisation on a field that declares it', () => {
    const normalized = workflowWith({
      shown: { type: 'text', required: true, clientVisible: true },
    });

    expect(normalized.steps[0].data.shown.clientVisible).toBe(true);
  });

  it('is absent, not false, on a field that does not declare it or declares false', () => {
    const normalized = workflowWith({
      implicit: { type: 'text', required: true },
      explicit: { type: 'text', required: true, clientVisible: false },
    });

    expect(normalized.steps[0].data.implicit).not.toHaveProperty('clientVisible');
    expect(normalized.steps[0].data.explicit).not.toHaveProperty('clientVisible');
  });

  it('rejects a non-boolean value', () => {
    expect(() =>
      workflowWith({ shown: { type: 'text', required: true, clientVisible: 'yes' } }),
    ).toThrow();
  });
});
