import { describe, expect, it } from 'vitest';
import type { OnboardingTransition } from './onboarding-transitions';
import { buildWorkflowPath } from './workflow-path';
import { layoutWorkflowGraph, NODE_HEIGHT, NODE_WIDTH, toEdgePath } from './workflow-graph-layout';
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
    toStep: 'collect_country',
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
    toStep: 'collect_details',
  }),
  transition({
    id: 'e3',
    fromStep: 'collect_details',
    appliedStep: 'collect_details',
    toStep: 'review_us',
    status: 'awaiting_manual_review',
  }),
  transition({
    id: 'e4',
    fromStep: 'review_us',
    appliedStep: 'review_us',
    toStep: null,
    status: 'approved',
    trigger: 'manual.approve',
    current: true,
  }),
];

describe('buildWorkflowPath', () => {
  it('reports each step the onboarding entered, against when it was entered', () => {
    const path = buildWorkflowPath(DEFINITION, WALKED);

    expect([...path.enteredAt.keys()]).toEqual([
      'collect_country',
      'collect_details',
      'review_us',
      'approved',
    ]);
  });

  it('names the terminal step a move ended on, which the trail itself cannot say', () => {
    // The engine clears currentStep on a terminal move, so 'approved' is only identifiable as the
    // declared target of review_us whose status matches the one recorded.
    expect(buildWorkflowPath(DEFINITION, WALKED).currentStep).toBe('approved');
  });

  it('distinguishes the two terminal steps by the status each move recorded', () => {
    const rejected = [
      ...WALKED.slice(0, 3),
      transition({
        id: 'e4',
        fromStep: 'review_us',
        appliedStep: 'review_us',
        toStep: null,
        status: 'rejected',
        trigger: 'manual.reject',
        current: true,
      }),
    ];

    expect(buildWorkflowPath(DEFINITION, rejected).currentStep).toBe('rejected');
  });

  it('reports nothing walked for an onboarding with no recorded transitions', () => {
    const path = buildWorkflowPath(DEFINITION, []);

    expect(path.currentStep).toBeNull();
    expect(path.enteredAt.size).toBe(0);
  });
});

describe('layoutWorkflowGraph', () => {
  const graph = layoutWorkflowGraph(DEFINITION, buildWorkflowPath(DEFINITION, WALKED));
  const nodeNamed = (name: string) => graph.nodes.find((node) => node.name === name)!;

  it('draws every declared step, not only the ones that were entered', () => {
    expect(graph.nodes.map((node) => node.name)).toEqual(DEFINITION.steps.map((step) => step.name));
  });

  it('marks a step the onboarding got through as completed', () => {
    expect(nodeNamed('collect_country').state).toBe('completed');
    expect(nodeNamed('collect_details').state).toBe('completed');
    expect(nodeNamed('review_us').state).toBe('completed');
  });

  it('marks a step the onboarding never reached as not taken', () => {
    expect(nodeNamed('review_default').state).toBe('pending');
    expect(nodeNamed('rejected').state).toBe('pending');
  });

  it('marks an approved ending as completed rather than as somewhere it is waiting', () => {
    expect(nodeNamed('approved').state).toBe('completed');
  });

  it('marks the step an in-flight onboarding is waiting on as the current one', () => {
    const inFlight = layoutWorkflowGraph(
      DEFINITION,
      buildWorkflowPath(DEFINITION, WALKED.slice(0, 3)),
    );
    const stepNamed = (name: string) => inFlight.nodes.find((node) => node.name === name)!;

    expect(stepNamed('review_us').state).toBe('current');
    expect(stepNamed('collect_details').state).toBe('completed');
    expect(stepNamed('approved').state).toBe('pending');
  });

  it('marks the step a rejected onboarding ended on as failed', () => {
    const rejectedWalk = [
      ...WALKED.slice(0, 3),
      transition({
        id: 'e4',
        fromStep: 'review_us',
        appliedStep: 'review_us',
        toStep: null,
        status: 'rejected',
        trigger: 'manual.reject',
        current: true,
      }),
    ];
    const failed = layoutWorkflowGraph(DEFINITION, buildWorkflowPath(DEFINITION, rejectedWalk));
    const stepNamed = (name: string) => failed.nodes.find((node) => node.name === name)!;

    expect(stepNamed('rejected').state).toBe('failed');
    // The steps before the failure were still got through, so they do not read as failures too.
    expect(stepNamed('review_us').state).toBe('completed');
    expect(stepNamed('approved').state).toBe('pending');
  });

  it('carries the instant an entered step was reached, and nothing for one that was not', () => {
    expect(nodeNamed('review_us').enteredAt).toBe('2026-07-01T10:00:00.000Z');
    expect(nodeNamed('review_default').enteredAt).toBeNull();
  });

  it('places a step below every step that leads to it', () => {
    expect(nodeNamed('collect_country').y).toBeLessThan(nodeNamed('collect_details').y);
    expect(nodeNamed('collect_details').y).toBeLessThan(nodeNamed('review_us').y);
    expect(nodeNamed('review_us').y).toBeLessThan(nodeNamed('approved').y);
  });

  it('places the two branches of a fork side by side on one row', () => {
    expect(nodeNamed('review_us').y).toBe(nodeNamed('review_default').y);
    expect(nodeNamed('review_us').x).not.toBe(nodeNamed('review_default').x);
  });

  it('draws a step both branches lead to exactly once', () => {
    expect(graph.nodes.filter((node) => node.name === 'approved')).toHaveLength(1);
    expect(graph.edges.filter((edge) => edge.to === 'approved')).toHaveLength(2);
  });

  it('routes each edge from the foot of its source to the head of its target', () => {
    const edge = graph.edges.find((edge) => edge.to === 'collect_details')!;
    const [start] = edge.points;
    const end = edge.points[edge.points.length - 1];

    expect(start[1]).toBe(nodeNamed('collect_country').y + NODE_HEIGHT);
    expect(end[0]).toBe(nodeNamed('collect_details').x + NODE_WIDTH / 2);
    expect(end[1]).toBe(nodeNamed('collect_details').y);
  });

  it('takes the colour of the step it points at, when it leaves a step that was completed', () => {
    const toneOf = (from: string, to: string) =>
      graph.edges.find((edge) => edge.from === from && edge.to === to)!.tone;

    expect(toneOf('collect_country', 'collect_details')).toBe('completed');
    expect(toneOf('review_us', 'approved')).toBe('completed');
  });

  it('stays neutral when it leaves a step the onboarding never reached', () => {
    // review_default was never entered, so its arrow into the green 'approved' box must not be
    // green: that would claim a move this onboarding never made.
    const toneOf = (from: string, to: string) =>
      graph.edges.find((edge) => edge.from === from && edge.to === to)!.tone;

    expect(nodeNamed('review_default').state).toBe('pending');
    expect(nodeNamed('approved').state).toBe('completed');
    expect(toneOf('review_default', 'approved')).toBe('pending');
  });

  it('stays neutral when it points at a step that was never reached', () => {
    const toneOf = (from: string, to: string) =>
      graph.edges.find((edge) => edge.from === from && edge.to === to)!.tone;

    expect(toneOf('review_us', 'rejected')).toBe('pending');
    expect(toneOf('collect_details', 'review_default')).toBe('pending');
  });

  it('paints the neutral arrows first, so a coloured one crossing them stays unbroken', () => {
    const firstColoured = graph.edges.findIndex((edge) => edge.tone !== 'pending');
    const lastNeutral = graph.edges.map((edge) => edge.tone === 'pending').lastIndexOf(true);

    expect(firstColoured).toBeGreaterThan(lastNeutral);
  });

  it('lands each arrow into a step on its own point, so heads do not pile up', () => {
    const intoApproved = graph.edges.filter((edge) => edge.to === 'approved');
    const heads = intoApproved.map((edge) => edge.points[edge.points.length - 1][0]);

    expect(heads).toHaveLength(2);
    expect(new Set(heads).size).toBe(2);
    // Both still arrive within the box they point at.
    for (const head of heads) {
      expect(head).toBeGreaterThan(nodeNamed('approved').x);
      expect(head).toBeLessThan(nodeNamed('approved').x + NODE_WIDTH);
    }
  });

  it('turns runs that would lie on each other at different heights', () => {
    // review_us reaches right for 'rejected' while review_default reaches left for 'approved', so
    // the two runs cross and cannot share a height.
    const laneOf = (from: string, to: string) => {
      const edge = graph.edges.find((item) => item.from === from && item.to === to)!;

      return edge.points.length === 4 ? edge.points[1][1] : null;
    };

    expect(laneOf('review_us', 'rejected')).not.toBe(laneOf('review_default', 'approved'));
  });

  it('turns a fork level even though both branches start on the same trunk', () => {
    // The two runs touch at the trunk and nowhere else, which is the fork rather than a clash.
    const [toReviewUs, toReviewDefault] = ['review_us', 'review_default'].map((to) =>
      graph.edges.find((edge) => edge.from === 'collect_details' && edge.to === to)!,
    );

    expect(toReviewUs.points).toHaveLength(4);
    expect(toReviewDefault.points).toHaveLength(4);
    expect(toReviewUs.points[1][1]).toBe(toReviewDefault.points[1][1]);
  });

  it('turns the two ways out of one step level when their runs do not meet', () => {
    // A fork whose branches head opposite ways has nothing to collide over, so both turn at one
    // height: separate heights there read as a flight of steps rather than as one shape.
    const forking: WorkflowDefinition = {
      ...DEFINITION,
      initialStep: 'verify_code',
      steps: [
        {
          name: 'verify_code',
          status: 'awaiting_user',
          terminal: false,
          transitions: [
            { status: 'success', target: 'approved' },
            { status: 'rejected', target: 'rejected' },
          ],
        },
        { name: 'approved', status: 'approved', terminal: true, transitions: [] },
        { name: 'rejected', status: 'rejected', terminal: true, transitions: [] },
      ],
    };
    const forkGraph = layoutWorkflowGraph(forking, buildWorkflowPath(forking, []));
    const [left, right] = forkGraph.edges;

    expect(left.points).toHaveLength(4);
    expect(right.points).toHaveLength(4);
    expect(left.points[1][1]).toBe(right.points[1][1]);
  });

  it('keeps an arriving edge off a vertical another edge already occupies', () => {
    // review_us and approved share a column and hand out anchors at the same offsets, so without
    // this the edge leaving review_us and the one arriving at approved sit on one vertical and
    // read as a single line broken in the middle.
    const leaving = graph.edges.find(
      (edge) => edge.from === 'review_us' && edge.to === 'rejected',
    )!;
    const arriving = graph.edges.find(
      (edge) => edge.from === 'review_default' && edge.to === 'approved',
    )!;

    const leavingX = leaving.points[0][0];
    const arrivingX = arriving.points[arriving.points.length - 1][0];

    expect(Math.abs(leavingX - arrivingX)).toBeGreaterThanOrEqual(12);
    // It is moved along the head of its own box, so it still points at the box it belongs to.
    expect(arrivingX).toBeGreaterThan(nodeNamed('approved').x);
    expect(arrivingX).toBeLessThan(nodeNamed('approved').x + NODE_WIDTH);
  });

  it('sends every edge out of a step from one point, so the ways out read as one trunk', () => {
    const departures = graph.edges
      .filter((edge) => edge.from === 'collect_details')
      .map((edge) => edge.points[0][0]);

    expect(departures).toHaveLength(2);
    expect(new Set(departures).size).toBe(1);
    // That one point is under the middle of the box it leaves.
    expect(departures[0]).toBe(nodeNamed('collect_details').x + NODE_WIDTH / 2);
  });

  it('separates the trunk at the break points, which is where the choice is made', () => {
    const [toReviewUs, toReviewDefault] = ['review_us', 'review_default'].map((to) =>
      graph.edges.find((edge) => edge.from === 'collect_details' && edge.to === to)!,
    );

    // Same departure, and from there each heads for its own target.
    expect(toReviewUs.points[0]).toEqual(toReviewDefault.points[0]);
    expect(toReviewUs.points[toReviewUs.points.length - 1][0]).toBeLessThan(
      toReviewDefault.points[toReviewDefault.points.length - 1][0],
    );
  });

  it('spreads arrivals along the head of the box, ordered by where they come from', () => {
    const [fromReviewUs, fromReviewDefault] = ['review_us', 'review_default'].map((from) =>
      graph.edges.find((edge) => edge.from === from && edge.to === 'rejected')!,
    );
    const headOf = (edge: (typeof graph.edges)[number]) => edge.points[edge.points.length - 1][0];

    // review_us is the left-hand source, so its arrow lands on the left-hand side of the head.
    expect(headOf(fromReviewUs)).toBeLessThan(headOf(fromReviewDefault));
  });

  it('runs an edge straight down when its target sits directly below its trunk', () => {
    // The spine must not jog around the arrowheads either side of it.
    const edge = graph.edges.find((item) => item.from === 'review_us' && item.to === 'approved')!;

    expect(edge.points).toHaveLength(2);
    expect(edge.points[0][0]).toBe(edge.points[1][0]);
    expect(edge.points[0][0]).toBe(nodeNamed('review_us').x + NODE_WIDTH / 2);
  });

  it('draws an edge that runs straight down as a plain line, taking no lane', () => {
    const straight = graph.edges.find((edge) => edge.to === 'collect_details')!;

    expect(straight.points).toHaveLength(2);
    expect(straight.points[0][0]).toBe(straight.points[1][0]);
  });

  it('reports a canvas large enough for every row it placed', () => {
    const lowest = Math.max(...graph.nodes.map((node) => node.y));

    expect(graph.height).toBeGreaterThanOrEqual(lowest + NODE_HEIGHT);
    expect(graph.width).toBeGreaterThanOrEqual(2 * NODE_WIDTH);
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
    const selfGraph = layoutWorkflowGraph(selfLooping, buildWorkflowPath(selfLooping, []));

    expect(selfGraph.nodes[0].selfTransitions).toEqual(['success']);
    expect(selfGraph.edges.some((edge) => edge.from === edge.to)).toBe(false);
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

    expect(layoutWorkflowGraph(cyclic, buildWorkflowPath(cyclic, [])).nodes).toHaveLength(2);
  });

  it('places a step nothing transitions to on a row of its own rather than dropping it', () => {
    const orphaned: WorkflowDefinition = {
      ...DEFINITION,
      steps: [
        ...DEFINITION.steps,
        { name: 'stranded', status: 'invalid', terminal: true, transitions: [] },
      ],
    };
    const orphanGraph = layoutWorkflowGraph(orphaned, buildWorkflowPath(orphaned, []));
    const stranded = orphanGraph.nodes.find((node) => node.name === 'stranded')!;

    expect(stranded.y).toBeGreaterThan(
      Math.max(
        ...orphanGraph.nodes.filter((node) => node.name !== 'stranded').map((node) => node.y),
      ),
    );
  });
});

describe('toEdgePath', () => {
  it('draws a straight run as a single line', () => {
    expect(
      toEdgePath([
        [10, 0],
        [10, 100],
      ]),
    ).toBe('M 10 0 L 10 100');
  });

  it('rounds a corner off instead of meeting at a point', () => {
    const path = toEdgePath([
      [0, 0],
      [0, 100],
      [80, 100],
    ]);

    // Pulls back before the corner, curves through it, then carries on: no square join for the
    // eye to read straight past.
    expect(path).toBe('M 0 0 L 0 90 Q 0 100 10 100 L 80 100');
  });

  it('shrinks the corner for a segment too short to take the full radius', () => {
    const path = toEdgePath([
      [0, 0],
      [0, 8],
      [40, 8],
    ]);

    expect(path).toBe('M 0 0 L 0 4 Q 0 8 4 8 L 40 8');
  });

  it('has nothing to draw for a single point', () => {
    expect(toEdgePath([[0, 0]])).toBe('');
  });
});
