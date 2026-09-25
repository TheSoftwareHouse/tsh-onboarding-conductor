import { describe, expect, it } from 'vitest';
import type { OnboardingTransition } from '@/api/onboardings/onboarding-transitions';
import type { WorkflowDefinition } from '@/api/workflows/workflow-definitions';
import { buildWorkflowPath, walkedEdgeKey } from './workflow-path';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  findCurrentStep,
  layoutWorkflowGraph,
} from './workflow-graph-layout';

/** The shipped `conditional-fields-and-transitions` workflow, which branches and reconverges. */
const DEFINITION: WorkflowDefinition = {
  workflowId: 'conditional-fields-and-transitions',
  workflowVersion: 1,
  initialStep: 'collect_country',
  scores: {},
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

  it('records only the moves that were made, and no step re-entering itself', () => {
    const path = buildWorkflowPath([
      ...WALKED,
      // An async connector parking and resuming: recorded, but it travels no edge.
      transition({ id: 'e5', fromStep: 'approved', enteredStep: 'approved' }),
    ]);

    expect([...path.walkedEdges].sort()).toEqual(
      [
        walkedEdgeKey('collect_country', 'collect_details'),
        walkedEdgeKey('collect_details', 'review_us'),
        walkedEdgeKey('review_us', 'approved'),
      ].sort(),
    );
    expect(path.walkedEdges.has(walkedEdgeKey('collect_details', 'review_default'))).toBe(false);
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
  const graph = layoutWorkflowGraph(DEFINITION, buildWorkflowPath(WALKED));
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
    const inFlight = layoutWorkflowGraph(DEFINITION, buildWorkflowPath(WALKED.slice(0, 3)));
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
    const failed = layoutWorkflowGraph(DEFINITION, buildWorkflowPath(rejectedWalk));
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

  it('draws one line per ordered pair, however many transitions declare it', () => {
    const twoWaysToTheSameStep: WorkflowDefinition = {
      workflowId: 'duplicate-arms',
      workflowVersion: 1,
      initialStep: 'review',
      scores: {},
      steps: [
        {
          name: 'review',
          status: 'awaiting_manual_review',
          terminal: false,
          transitions: [
            { status: 'manual.reject', target: 'rejected' },
            // A second operator action reaching the same step: one arrow, not two.
            { status: 'manual.invalid', target: 'rejected' },
          ],
        },
        { name: 'rejected', status: 'rejected', terminal: true, transitions: [] },
      ],
    };

    const graph = layoutWorkflowGraph(twoWaysToTheSameStep, buildWorkflowPath([]));

    expect(
      graph.edges.filter((edge) => edge.source === 'review' && edge.target === 'rejected'),
    ).toHaveLength(1);
  });

  it('still draws both directions when a pair is joined each way', () => {
    const opposed: WorkflowDefinition = {
      workflowId: 'opposed',
      workflowVersion: 1,
      initialStep: 'capture',
      scores: {},
      steps: [
        {
          name: 'capture',
          status: 'awaiting_user',
          terminal: false,
          transitions: [{ status: 'success', target: 'submit' }],
        },
        {
          name: 'submit',
          status: 'awaiting_user',
          terminal: false,
          // Two arms back to `capture` plus the forward arm: the duplicates collapse, the
          // opposed pair still merges into one line with an arrowhead at each end.
          transitions: [
            { status: 'success', target: 'capture' },
            { status: 'success', target: 'capture' },
          ],
        },
      ],
    };

    const graph = layoutWorkflowGraph(opposed, buildWorkflowPath([]));

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].markerStart).toBeDefined();
    expect(graph.edges[0].markerEnd).toBeDefined();
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

  it('orders a coloured edge after the neutral ones, so one crossing it stays unbroken', () => {
    const tones = graph.edges.map((edge) => edge.data!.tone);
    const lastNeutral = tones.lastIndexOf('pending');
    const firstColoured = tones.findIndex((tone) => tone !== 'pending');

    expect(firstColoured).toBeGreaterThan(lastNeutral);
  });

  it('never lifts an edge above the node layer, which would draw it across the boxes', () => {
    for (const edge of graph.edges) {
      expect(edge.zIndex).toBeUndefined();
    }
  });

  it('carries the route dagre laid out, running from the source down to the target', () => {
    const edge = graph.edges.find(
      (candidate) =>
        candidate.source === 'collect_country' && candidate.target === 'collect_details',
    )!;
    const points = edge.data!.points;
    const y = (name: string) => graph.nodes.find((node) => node.id === name)!.position.y;

    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points[0]!.y).toBeGreaterThanOrEqual(y('collect_country'));
    expect(points[points.length - 1]!.y).toBeLessThanOrEqual(y('collect_details') + NODE_HEIGHT);
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
    const selfGraph = layoutWorkflowGraph(selfLooping, buildWorkflowPath([]));

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
    const retryGraph = layoutWorkflowGraph(retrying, buildWorkflowPath([]));
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
    const loopGraph = layoutWorkflowGraph(looping, buildWorkflowPath([]));
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

    expect(layoutWorkflowGraph(cyclic, buildWorkflowPath([])).nodes).toHaveLength(2);
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
    const danglingGraph = layoutWorkflowGraph(dangling, buildWorkflowPath([]));

    expect(danglingGraph.nodes).toHaveLength(2);
    expect(danglingGraph.edges).toHaveLength(1);
  });

  it('draws a workflow that declares no steps at all', () => {
    const empty: WorkflowDefinition = { ...DEFINITION, steps: [] };
    const emptyGraph = layoutWorkflowGraph(empty, buildWorkflowPath([]));

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
    const orphanGraph = layoutWorkflowGraph(orphaned, buildWorkflowPath([]));

    expect(orphanGraph.nodes.some((node) => node.id === 'stranded')).toBe(true);
  });
});

describe('layoutWorkflowGraph, for a workflow that loops back', () => {
  /** A retry branch, like `sumsub-kyc`'s: one step sends the onboarding back up the drawing. */
  const LOOPING: WorkflowDefinition = {
    workflowId: 'looping',
    workflowVersion: 1,
    initialStep: 'capture',
    scores: {},
    steps: [
      {
        name: 'capture',
        status: 'awaiting_user',
        terminal: false,
        transitions: [{ status: 'success', target: 'submit' }],
      },
      {
        name: 'submit',
        status: 'awaiting_user',
        terminal: false,
        transitions: [
          { status: 'success', target: 'capture', when: { field: 'outcome', equals: 'retry' } },
          { status: 'success', target: 'review', when: { field: 'outcome', equals: 'review' } },
          // Skips `review` entirely, so its route has to get past that box.
          { status: 'success', target: 'approved' },
        ],
      },
      {
        name: 'review',
        status: 'awaiting_manual_review',
        terminal: false,
        transitions: [{ status: 'manual.approve', target: 'approved' }],
      },
      { name: 'approved', status: 'approved', terminal: true, transitions: [] },
    ],
  };

  const graph = layoutWorkflowGraph(LOOPING, buildWorkflowPath([]));
  const edgeTo = (target: string) => graph.edges.find((edge) => edge.target === target)!;

  it('routes a transition that goes back up around the column, not through it', () => {
    const points = edgeTo('capture').data!.points;
    const columnLeft = Math.min(...graph.nodes.map((node) => node.position.x));

    expect(edgeTo('capture').source).toBe('submit');
    // More than a straight line between two endpoints: dagre bent it around what sits between.
    expect(points.length).toBeGreaterThan(2);
    expect(Math.min(...points.map((point) => point.x))).toBeLessThan(columnLeft + NODE_WIDTH / 2);
  });

  it('never draws an edge across a node it is not attached to', () => {
    for (const edge of graph.edges) {
      for (const node of graph.nodes) {
        if (node.id === edge.source || node.id === edge.target) {
          continue;
        }

        const crossings = edge.data!.points.filter(
          (point) =>
            point.x > node.position.x &&
            point.x < node.position.x + NODE_WIDTH &&
            point.y > node.position.y &&
            point.y < node.position.y + NODE_HEIGHT,
        );

        expect(crossings).toEqual([]);
      }
    }
  });

  it('collapses a pair joined both ways into one double-headed edge', () => {
    const between = graph.edges.filter(
      (edge) =>
        (edge.source === 'capture' && edge.target === 'submit') ||
        (edge.source === 'submit' && edge.target === 'capture'),
    );

    expect(between).toHaveLength(1);
    expect(between[0]!.markerStart).toBeDefined();
    expect(between[0]!.markerEnd).toBeDefined();
  });

  it('leaves a one-way transition with a single arrowhead', () => {
    const oneWay = graph.edges.find(
      (edge) => edge.source === 'submit' && edge.target === 'approved',
    )!;

    expect(oneWay.markerStart).toBeUndefined();
    expect(oneWay.markerEnd).toBeDefined();
  });

  it('keeps every one-way transition out of a step as its own edge', () => {
    const outgoing = graph.edges.filter(
      (edge) => edge.source === 'submit' || edge.target === 'submit',
    );

    expect(outgoing.map((edge) => edge.target).sort()).toEqual(['approved', 'capture', 'review']);
  });

  it('routes a transition that skips a rank around the step it skips', () => {
    const skipping = graph.edges.find(
      (edge) => edge.source === 'submit' && edge.target === 'approved',
    )!;

    expect(skipping.data!.points.length).toBeGreaterThan(2);
  });

  it('places the looped-to step above the step that loops back to it', () => {
    const y = (name: string) => graph.nodes.find((node) => node.id === name)!.position.y;

    expect(y('capture')).toBeLessThan(y('submit'));
  });
});

describe('layoutWorkflowGraph, for a step with a route it did not take', () => {
  /**
   * `sumsub-kyc`'s shape: `submit` can reach `approved` directly or by way of `review`, and this
   * onboarding went the long way. Both ends of the direct edge are completed even though the
   * edge itself was never used, which is what a colouring rule reading only the endpoints gets
   * wrong.
   */
  const BYPASSED: WorkflowDefinition = {
    workflowId: 'bypassed',
    workflowVersion: 1,
    initialStep: 'submit',
    scores: {},
    steps: [
      {
        name: 'submit',
        status: 'awaiting_user',
        terminal: false,
        transitions: [
          { status: 'success', target: 'approved', when: { field: 'outcome', equals: 'clean' } },
          { status: 'success', target: 'review' },
        ],
      },
      {
        name: 'review',
        status: 'awaiting_manual_review',
        terminal: false,
        transitions: [{ status: 'manual.approve', target: 'approved' }],
      },
      { name: 'approved', status: 'approved', terminal: true, transitions: [] },
    ],
  };

  const graph = layoutWorkflowGraph(
    BYPASSED,
    buildWorkflowPath([
      transition({ enteredStep: 'submit' }),
      transition({ id: 'e2', fromStep: 'submit', enteredStep: 'review' }),
      transition({ id: 'e3', fromStep: 'review', enteredStep: 'approved', current: true }),
    ]),
  );

  const toneOf = (from: string, to: string) =>
    graph.edges.find((edge) => edge.source === from && edge.target === to)!.data!.tone;

  it('leaves the route it skipped neutral, though both of its ends were completed', () => {
    expect(toneOf('submit', 'approved')).toBe('pending');
  });

  it('colours the route it actually walked', () => {
    expect(toneOf('submit', 'review')).toBe('completed');
    expect(toneOf('review', 'approved')).toBe('completed');
  });

  it('still marks both ends of the skipped route as reached', () => {
    const stateOf = (name: string) => graph.nodes.find((node) => node.id === name)!.data.state;

    expect(stateOf('submit')).toBe('completed');
    expect(stateOf('approved')).toBe('completed');
  });
});

describe('findCurrentStep', () => {
  it('finds the step an in-flight onboarding is waiting on', () => {
    const inFlight = layoutWorkflowGraph(DEFINITION, buildWorkflowPath(WALKED.slice(0, 3)));

    expect(findCurrentStep(inFlight)?.id).toBe('review_us');
  });

  it('finds no step for an onboarding that has settled on a terminal one', () => {
    expect(
      findCurrentStep(layoutWorkflowGraph(DEFINITION, buildWorkflowPath(WALKED))),
    ).toBeUndefined();
  });

  it('finds no step for an onboarding with nothing recorded yet', () => {
    expect(findCurrentStep(layoutWorkflowGraph(DEFINITION, buildWorkflowPath([])))).toBeUndefined();
  });
});
