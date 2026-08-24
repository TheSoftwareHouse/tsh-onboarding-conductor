import { describe, expect, it } from 'vitest';
import type { OnboardingTransition } from './onboarding-transitions';
import { buildWorkflowPath } from './workflow-path';
import { layoutWorkflowGraph } from './workflow-graph-layout';
import type { WorkflowDefinition } from '../types/workflow-definition';

/** The shipped `conditional-fields-and-transitions` workflow, which branches and reconverges. */
const DEFINITION: WorkflowDefinition = {
  workflowId: 'conditional-fields-and-transitions',
  workflowVersion: 1,
  name: 'Conditional fields and transitions',
  initialStep: 'collect_country',
  steps: [
    {
      name: 'collect_country',
      status: 'awaiting_user',
      terminal: false,
      transitions: [{ status: 'success', target: 'collect_details' }],
    },
    {
      name: 'collect_details',
      status: 'awaiting_user',
      terminal: false,
      transitions: [
        { status: 'success', target: 'review_us', when: { field: 'country', equals: 'US' } },
        { status: 'success', target: 'review_default' },
      ],
    },
    {
      name: 'review_us',
      status: 'awaiting_manual_review',
      terminal: false,
      transitions: [
        { status: 'manual.approve', target: 'approved' },
        { status: 'manual.reject', target: 'rejected' },
      ],
    },
    {
      name: 'review_default',
      status: 'awaiting_manual_review',
      terminal: false,
      transitions: [
        { status: 'manual.approve', target: 'approved' },
        { status: 'manual.reject', target: 'rejected' },
      ],
    },
    { name: 'approved', status: 'approved', terminal: true, transitions: [] },
    { name: 'rejected', status: 'rejected', terminal: true, transitions: [] },
  ],
};

function transition(overrides: Partial<OnboardingTransition>): OnboardingTransition {
  return {
    id: 'event',
    occurredAt: '2026-07-01T10:00:00.000Z',
    label: 'collect_country',
    status: 'awaiting_user',
    fromStep: null,
    appliedStep: null,
    enteredStep: 'collect_country',
    trigger: null,
    current: false,
    ...overrides,
  };
}

/** A US onboarding that was approved: started, moved twice, then a manual decision. */
const WALKED: OnboardingTransition[] = [
  transition({ id: 'e1' }),
  transition({
    id: 'e2',
    fromStep: 'collect_country',
    appliedStep: 'collect_country',
    enteredStep: 'collect_details',
  }),
  transition({
    id: 'e3',
    fromStep: 'collect_details',
    appliedStep: 'collect_details',
    enteredStep: 'review_us',
    status: 'awaiting_manual_review',
  }),
  transition({
    id: 'e4',
    fromStep: 'review_us',
    appliedStep: 'review_us',
    enteredStep: 'approved',
    status: 'approved',
    trigger: 'manual.approve',
    current: true,
  }),
];

describe('buildWorkflowPath', () => {
  it('reports each step the onboarding entered, against when it was entered', () => {
    const path = buildWorkflowPath(WALKED);

    expect([...path.enteredAt.keys()]).toEqual([
      'collect_country',
      'collect_details',
      'review_us',
      'approved',
    ]);
  });

  it('reports the last step entered as where the onboarding stands', () => {
    // The engine resolves the terminal step a move ended on, which the record cannot name itself.
    expect(buildWorkflowPath(WALKED).currentStep).toBe('approved');
  });

  it('keeps the instant a step was first entered when a loop returns to it', () => {
    const looped = [
      ...WALKED.slice(0, 2),
      transition({
        id: 'e3',
        occurredAt: '2026-07-01T14:00:00.000Z',
        fromStep: 'collect_details',
        appliedStep: 'collect_details',
        enteredStep: 'collect_country',
      }),
    ];

    expect(buildWorkflowPath(looped).enteredAt.get('collect_country')).toBe(
      '2026-07-01T10:00:00.000Z',
    );
    expect(buildWorkflowPath(looped).currentStep).toBe('collect_country');
  });

  it('skips a move whose step the engine could not name', () => {
    const unnamed = [...WALKED.slice(0, 3), transition({ id: 'e4', enteredStep: null })];

    // The named steps still report, and the onboarding is not claimed to stand nowhere.
    expect(buildWorkflowPath(unnamed).currentStep).toBe('review_us');
    expect(buildWorkflowPath(unnamed).enteredAt.has('approved')).toBe(false);
  });

  it('reports nothing walked for an onboarding with no recorded transitions', () => {
    const path = buildWorkflowPath([]);

    expect(path.currentStep).toBeNull();
    expect(path.enteredAt.size).toBe(0);
  });
});

describe('layoutWorkflowGraph', () => {
  const graph = layoutWorkflowGraph(DEFINITION.steps, buildWorkflowPath(WALKED));
  const nodeNamed = (name: string) => graph.nodes.find((node) => node.id === name)!;

  it('draws every declared step, not only the ones that were entered', () => {
    expect(graph.nodes.map((node) => node.id)).toEqual(DEFINITION.steps.map((step) => step.name));
  });

  it('marks a step the onboarding got through as completed', () => {
    expect(nodeNamed('collect_country').data.state).toBe('completed');
    expect(nodeNamed('collect_details').data.state).toBe('completed');
    expect(nodeNamed('review_us').data.state).toBe('completed');
  });

  it('marks a step the onboarding never reached as not taken', () => {
    expect(nodeNamed('review_default').data.state).toBe('pending');
    expect(nodeNamed('rejected').data.state).toBe('pending');
  });

  it('marks an approved ending as completed rather than as somewhere it is waiting', () => {
    expect(nodeNamed('approved').data.state).toBe('completed');
  });

  it('marks the step an in-flight onboarding is waiting on as the current one', () => {
    const inFlight = layoutWorkflowGraph(DEFINITION.steps, buildWorkflowPath(WALKED.slice(0, 3)));
    const stepNamed = (name: string) => inFlight.nodes.find((node) => node.id === name)!;

    expect(stepNamed('review_us').data.state).toBe('current');
    expect(stepNamed('collect_details').data.state).toBe('completed');
    expect(stepNamed('approved').data.state).toBe('pending');
  });

  it('marks the step a rejected onboarding ended on as failed', () => {
    const rejectedWalk = [
      ...WALKED.slice(0, 3),
      transition({
        id: 'e4',
        fromStep: 'review_us',
        appliedStep: 'review_us',
        enteredStep: 'rejected',
        status: 'rejected',
        trigger: 'manual.reject',
        current: true,
      }),
    ];
    const failed = layoutWorkflowGraph(DEFINITION.steps, buildWorkflowPath(rejectedWalk));
    const stepNamed = (name: string) => failed.nodes.find((node) => node.id === name)!;

    expect(stepNamed('rejected').data.state).toBe('failed');
    // The steps before the failure were still got through, so they do not read as failures too.
    expect(stepNamed('review_us').data.state).toBe('completed');
    expect(stepNamed('approved').data.state).toBe('pending');
  });

  it('carries the instant an entered step was reached, and nothing for one that was not', () => {
    expect(nodeNamed('review_us').data.enteredAt).toBe('2026-07-01T10:00:00.000Z');
    expect(nodeNamed('review_default').data.enteredAt).toBeNull();
  });

  it('places a step below every step that leads to it', () => {
    expect(nodeNamed('collect_country').position.y).toBeLessThan(
      nodeNamed('collect_details').position.y,
    );
    expect(nodeNamed('collect_details').position.y).toBeLessThan(nodeNamed('review_us').position.y);
    expect(nodeNamed('review_us').position.y).toBeLessThan(nodeNamed('approved').position.y);
  });

  it('places the two branches of a fork side by side on one row', () => {
    expect(nodeNamed('review_us').position.y).toBe(nodeNamed('review_default').position.y);
    expect(nodeNamed('review_us').position.x).not.toBe(nodeNamed('review_default').position.x);
  });

  it('draws a step both branches lead to exactly once', () => {
    expect(graph.nodes.filter((node) => node.id === 'approved')).toHaveLength(1);
    expect(graph.edges.filter((edge) => edge.target === 'approved')).toHaveLength(2);
  });

  it('takes the colour of the step it points at, when it leaves a step that was completed', () => {
    const toneOf = (from: string, to: string) =>
      graph.edges.find((edge) => edge.source === from && edge.target === to)!.data!.tone;

    expect(toneOf('collect_country', 'collect_details')).toBe('completed');
    expect(toneOf('review_us', 'approved')).toBe('completed');
  });

  it('stays neutral when it leaves a step the onboarding never reached', () => {
    // review_default was never entered, so its arrow into the green 'approved' box must not be
    // green: that would claim a move this onboarding never made.
    const toneOf = (from: string, to: string) =>
      graph.edges.find((edge) => edge.source === from && edge.target === to)!.data!.tone;

    expect(nodeNamed('review_default').data.state).toBe('pending');
    expect(nodeNamed('approved').data.state).toBe('completed');
    expect(toneOf('review_default', 'approved')).toBe('pending');
  });

  it('stays neutral when it points at a step that was never reached', () => {
    const toneOf = (from: string, to: string) =>
      graph.edges.find((edge) => edge.source === from && edge.target === to)!.data!.tone;

    expect(toneOf('review_us', 'rejected')).toBe('pending');
    expect(toneOf('collect_details', 'review_default')).toBe('pending');
  });

  it('raises a coloured edge above the neutral ones, so one crossing it stays unbroken', () => {
    const coloured = graph.edges.filter((edge) => edge.data!.tone !== 'pending');
    const neutral = graph.edges.filter((edge) => edge.data!.tone === 'pending');

    expect(coloured.length).toBeGreaterThan(0);
    for (const edge of coloured) {
      expect(edge.zIndex).toBeGreaterThan(neutral[0]!.zIndex!);
    }
  });

  it('keeps a self-transition as a label on its step rather than an edge to nowhere', () => {
    const selfLooping: WorkflowDefinition = {
      ...DEFINITION,
      steps: [
        {
          name: 'collect_country',
          status: 'awaiting_user',
          terminal: false,
          transitions: [
            { status: 'success', target: null },
            { status: 'success', target: 'collect_details' },
          ],
        },
        ...DEFINITION.steps.slice(1),
      ],
    };
    const selfGraph = layoutWorkflowGraph(selfLooping.steps, buildWorkflowPath([]));

    expect(selfGraph.nodes[0]!.data.selfTransitions).toEqual(['success']);
    expect(selfGraph.edges.some((edge) => edge.source === edge.target)).toBe(false);
  });

  it('keeps a retry loop from pushing the steps it touches out of order', () => {
    // collect -> verify, and verify either finishes or sends the onboarding back to collect. The
    // retry transition is not progress, so it must not read as though it were.
    const retrying: WorkflowDefinition = {
      ...DEFINITION,
      initialStep: 'collect',
      steps: [
        {
          name: 'collect',
          status: 'awaiting_user',
          terminal: false,
          transitions: [{ status: 'success', target: 'verify' }],
        },
        {
          name: 'verify',
          status: 'awaiting_manual_review',
          terminal: false,
          transitions: [
            { status: 'manual.approve', target: 'approved' },
            { status: 'manual.reject', target: 'collect' },
          ],
        },
        { name: 'approved', status: 'approved', terminal: true, transitions: [] },
      ],
    };
    const retryGraph = layoutWorkflowGraph(retrying.steps, buildWorkflowPath([]));
    const yOf = (name: string) => retryGraph.nodes.find((node) => node.id === name)!.position.y;

    expect(yOf('collect')).toBeLessThan(yOf('verify'));
    expect(yOf('verify')).toBeLessThan(yOf('approved'));
    // The retry transition back to 'collect' is still drawn as an edge, not dropped.
    expect(
      retryGraph.edges.some((edge) => edge.source === 'verify' && edge.target === 'collect'),
    ).toBe(true);
  });

  it('keeps the initial step above every step reachable from it, loop or no loop', () => {
    const looping: WorkflowDefinition = {
      ...DEFINITION,
      initialStep: 'a',
      steps: [
        {
          name: 'a',
          status: 'awaiting_user',
          terminal: false,
          transitions: [{ status: 'success', target: 'b' }],
        },
        {
          name: 'b',
          status: 'awaiting_user',
          terminal: false,
          transitions: [{ status: 'success', target: 'c' }],
        },
        {
          name: 'c',
          status: 'awaiting_user',
          terminal: false,
          transitions: [{ status: 'success', target: 'a' }],
        },
      ],
    };
    const loopGraph = layoutWorkflowGraph(looping.steps, buildWorkflowPath([]));
    const yOf = (name: string) => loopGraph.nodes.find((node) => node.id === name)!.position.y;

    expect(yOf('a')).toBeLessThan(yOf('b'));
    expect(yOf('b')).toBeLessThan(yOf('c'));
  });

  it('still terminates and places every step when the workflow declares a cycle', () => {
    const cyclic: WorkflowDefinition = {
      ...DEFINITION,
      steps: [
        {
          name: 'collect_country',
          status: 'awaiting_user',
          terminal: false,
          transitions: [{ status: 'success', target: 'collect_details' }],
        },
        {
          name: 'collect_details',
          status: 'awaiting_user',
          terminal: false,
          transitions: [{ status: 'success', target: 'collect_country' }],
        },
      ],
    };

    expect(layoutWorkflowGraph(cyclic.steps, buildWorkflowPath([])).nodes).toHaveLength(2);
  });

  it('draws no node and no edge for a transition target no step declares', () => {
    const dangling: WorkflowDefinition = {
      ...DEFINITION,
      initialStep: 'collect',
      steps: [
        {
          name: 'collect',
          status: 'awaiting_user',
          terminal: false,
          transitions: [
            { status: 'success', target: 'approved' },
            { status: 'failure', target: 'no_such_step' },
          ],
        },
        { name: 'approved', status: 'approved', terminal: true, transitions: [] },
      ],
    };
    const danglingGraph = layoutWorkflowGraph(dangling.steps, buildWorkflowPath([]));

    expect(danglingGraph.nodes).toHaveLength(2);
    expect(danglingGraph.edges).toHaveLength(1);
  });

  it('draws a workflow that declares no steps at all', () => {
    const empty: WorkflowDefinition = { ...DEFINITION, steps: [] };
    const emptyGraph = layoutWorkflowGraph(empty.steps, buildWorkflowPath([]));

    expect(emptyGraph.nodes).toEqual([]);
    expect(emptyGraph.edges).toEqual([]);
  });

  it('places a step nothing transitions to somewhere on the drawing rather than dropping it', () => {
    const orphaned: WorkflowDefinition = {
      ...DEFINITION,
      steps: [
        ...DEFINITION.steps,
        { name: 'stranded', status: 'invalid', terminal: true, transitions: [] },
      ],
    };
    const orphanGraph = layoutWorkflowGraph(orphaned.steps, buildWorkflowPath([]));

    expect(orphanGraph.nodes.some((node) => node.id === 'stranded')).toBe(true);
  });
});
