import { validateSkipGraph } from './skip-graph';
import {
  DEFAULT_STEP_WEIGHT,
  type NormalizedWorkflowStep,
  type NormalizedWorkflowStepSkip,
} from '../workflow-contract';
import { WorkflowInvalidError } from '../workflow-invalid.error';

const step = (name: string, skip?: NormalizedWorkflowStepSkip): NormalizedWorkflowStep => ({
  name,
  status: 'awaiting_user',
  data: {},
  connectors: [],
  transitions: [],
  terminal: false,
  scoring: { weight: DEFAULT_STEP_WEIGHT },
  ...(skip === undefined ? {} : { skip }),
});

const skipTo = (target: string): NormalizedWorkflowStepSkip => ({
  when: { field: 'age', gte: 18 },
  target,
});

const validate = (steps: readonly NormalizedWorkflowStep[]): void => {
  const stepsByName = Object.fromEntries(steps.map((entry) => [entry.name, entry]));
  validateSkipGraph(steps, stepsByName);
};

describe('validateSkipGraph', () => {
  it('accepts a workflow declaring no skips at all', () => {
    expect(() => validate([step('a'), step('b')])).not.toThrow();
  });

  it('accepts a single skip and a multi-hop chain', () => {
    expect(() => validate([step('a', skipTo('b')), step('b')])).not.toThrow();

    expect(() =>
      validate([step('a', skipTo('b')), step('b', skipTo('c')), step('c', skipTo('d')), step('d')]),
    ).not.toThrow();
  });

  it('accepts two steps skipping to the same target', () => {
    expect(() =>
      validate([step('a', skipTo('c')), step('b', skipTo('c')), step('c')]),
    ).not.toThrow();
  });

  it('rejects a skip whose target is not a declared step', () => {
    expect(() => validate([step('a', skipTo('nowhere')), step('b')])).toThrow(WorkflowInvalidError);
  });

  it('rejects a step skipping to itself', () => {
    expect(() => validate([step('a', skipTo('a'))])).toThrow(WorkflowInvalidError);
  });

  it('rejects a two-step cycle', () => {
    expect(() => validate([step('a', skipTo('b')), step('b', skipTo('a'))])).toThrow(
      WorkflowInvalidError,
    );
  });

  it('rejects a longer cycle', () => {
    expect(() =>
      validate([step('a', skipTo('b')), step('b', skipTo('c')), step('c', skipTo('a'))]),
    ).toThrow(WorkflowInvalidError);
  });

  it('rejects a cycle that the entry step only leads into', () => {
    // `a` is not part of the cycle itself, so a walk that stopped at the first visited node
    // would miss it.
    expect(() =>
      validate([step('a', skipTo('b')), step('b', skipTo('c')), step('c', skipTo('b'))]),
    ).toThrow(WorkflowInvalidError);
  });
});
