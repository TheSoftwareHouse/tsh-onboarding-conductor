import { describe, expect, it } from 'vitest';
import type {
  WorkflowDefinition,
  WorkflowStepDefinition,
} from '@/api/workflows/workflow-definitions';
import { RANK_GAP } from './canvas-layout';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  layoutWorkflowGraph,
  labelBox,
  MAX_LABEL_CHARS,
  placeLabels,
  type WorkflowGraphEdge,
  type WorkflowStepNode,
} from './workflow-graph-layout';

function step(
  overrides: Partial<WorkflowStepDefinition> & { name: string },
): WorkflowStepDefinition {
  return {
    status: 'awaiting_user',
    terminal: false,
    transitions: [],
    source: null,
    fields: [],
    connectors: [],
    ...overrides,
  };
}

const DEFINITION: WorkflowDefinition = {
  workflowId: 'kyc',
  workflowVersion: 1,
  name: null,
  initialStep: 'collect',
  scores: {},
  webhook: null,
  steps: [
    step({
      name: 'collect',
      fields: [
        { name: 'a', type: 'string', required: true, persist: true, schema: {}, upload: null },
      ],
      transitions: [
        { status: 'success', target: 'verify', when: { field: 'a', equals: 'x' }, reason: null },
        { status: 'success', target: 'verify', reason: null },
        { status: 'success', target: 'review', reason: null },
        { status: 'rejected', target: null, reason: null },
      ],
    }),
    step({
      name: 'verify',
      status: 'awaiting_provider',
      connectors: [
        {
          id: 'sumsub',
          authoredId: 'sumsub',
          selected: false,
          selectableIds: [],
          versions: [],
          name: 'Sumsub',
          type: 'kyc',
          order: 1,
          canReject: true,
          async: true,
          fieldMapping: {},
          optionalFieldMapping: {},
          fallbacks: [],
        },
      ],
      transitions: [
        { status: 'success', target: 'approved', reason: null },
        { status: 'retry', target: 'collect', reason: null },
        { status: 'rejected', target: 'review', reason: null },
        { status: 'error', target: 'review', reason: null },
      ],
    }),
    step({
      name: 'review',
      status: 'awaiting_manual_review',
      transitions: [{ status: 'manual.approve', target: 'approved', reason: null }],
    }),
    step({ name: 'approved', status: 'approved', terminal: true }),
  ],
};

describe('layoutWorkflowGraph', () => {
  const { nodes, edges } = layoutWorkflowGraph(DEFINITION);
  const byId = (id: string) => nodes.find((node) => node.id === id);
  const edge = (source: string, target: string) =>
    edges.find((candidate) => candidate.source === source && candidate.target === target);

  it('places the initial step above every other step', () => {
    const initialY = byId('collect')?.position.y ?? Number.NaN;

    expect(initialY).toBe(0);
    for (const node of nodes.filter((candidate) => candidate.id !== 'collect')) {
      expect(node.position.y).toBeGreaterThan(initialY);
    }
  });

  it('draws one edge per ordered pair however many transitions join it', () => {
    const pairs = edges.map((candidate) => `${candidate.source}>${candidate.target}`);

    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs.filter((pair) => pair === 'collect>verify')).toHaveLength(1);
  });

  it('draws a pair joined both ways as two edges, the loop back round an outer lane', () => {
    const right = Math.max(...nodes.map((node) => node.position.x + NODE_WIDTH));
    const left = Math.min(...nodes.map((node) => node.position.x));
    const outside = (point: { x: number }) => point.x > right || point.x < left;

    expect(edge('collect', 'verify')?.markerStart).toBeUndefined();
    expect(edge('verify', 'collect')?.markerEnd).toBeDefined();
    expect(edge('verify', 'collect')?.data?.points.some(outside)).toBe(true);
    expect(edge('collect', 'verify')?.data?.points.some(outside)).toBe(false);
  });

  it('turns every edge only at right angles', () => {
    for (const candidate of edges) {
      const points = candidate.data?.points ?? [];
      points.slice(1).forEach((point, index) => {
        const previous = points[index]!;
        expect(point.x === previous.x || point.y === previous.y).toBe(true);
      });
    }
  });

  it('dashes only a loop back, whatever the status of an edge going down', () => {
    expect(edge('verify', 'collect')?.style?.strokeDasharray).toBe('5 4');
    expect(edge('verify', 'review')?.style?.strokeDasharray).toBeUndefined();
    expect(edge('collect', 'review')?.style?.strokeDasharray).toBeUndefined();
  });

  it('labels a guarded edge and its fallback arm, and leaves a plain success edge unlabelled', () => {
    expect(edge('collect', 'verify')?.data?.label).toContain('success when a = x');
    expect(edge('collect', 'verify')?.data?.condition).toBe('a = x · success · fallback');
    expect(edge('verify', 'collect')?.data?.condition).toBe('retry');
    expect(edge('collect', 'review')?.data?.condition).toBe('success · fallback');
    expect(edge('verify', 'approved')?.data?.label).toBe('');
  });

  it('puts the label of a labelled edge on its own line, and gives a plain edge none', () => {
    const labelled = edge('collect', 'verify');
    const at = labelled?.data?.labelPosition;
    const points = labelled?.data?.points ?? [];
    const onLine = points.slice(1).some((point, index) => {
      const previous = points[index]!;
      const within = (value: number, a: number, b: number) =>
        value >= Math.min(a, b) && value <= Math.max(a, b);
      return (
        at !== null &&
        at !== undefined &&
        within(at.x, previous.x, point.x) &&
        within(at.y, previous.y, point.y)
      );
    });

    expect(onLine).toBe(true);
    expect(edge('verify', 'approved')?.data?.labelPosition).toBeNull();
  });

  it('keeps the labels of the edges leaving one step clear of each other', () => {
    const boxes = edges
      .filter((candidate) => candidate.source === 'collect' && candidate.data?.labelPosition)
      .map((candidate) => {
        const { width, height } = labelBox(candidate.data!.displayLabel);
        const { x, y } = candidate.data!.labelPosition!;
        return {
          left: x - width / 2,
          right: x + width / 2,
          top: y - height / 2,
          bottom: y + height / 2,
        };
      });
    const meet = (a: (typeof boxes)[number], b: (typeof boxes)[number]) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

    expect(boxes.length).toBeGreaterThan(1);
    boxes.forEach((box, index) =>
      boxes.slice(index + 1).forEach((other) => expect(meet(box, other)).toBe(false)),
    );
  });

  it('keeps self-transitions as node data rather than edges', () => {
    expect(byId('collect')?.data.selfTransitions).toEqual(['rejected']);
    expect(edges.every((candidate) => candidate.source !== candidate.target)).toBe(true);
  });

  it('builds the subtitle from terminal, connector or fields', () => {
    expect(byId('approved')?.data.subtitle).toBe('terminal');
    expect(byId('verify')?.data.subtitle).toBe('sumsub · async · canReject');
    expect(byId('collect')?.data.subtitle).toBe('awaiting_user · 1 field');
    expect(byId('review')?.data.subtitle).toBe('awaiting_manual_review');
  });

  it('reports a transition count only for a step with more than three', () => {
    expect(byId('collect')?.data.transitionCount).toBe(4);
    expect(byId('review')?.data.transitionCount).toBeNull();
  });
});

describe('layoutWorkflowGraph spacing and labels', () => {
  const chain = (length: number): WorkflowDefinition => ({
    workflowId: 'chain',
    workflowVersion: 1,
    name: null,
    initialStep: 's0',
    scores: {},
    webhook: null,
    steps: Array.from({ length }, (_, index) =>
      step({
        name: `s${index}`,
        transitions:
          index < length - 1 ? [{ status: 'success', target: `s${index + 1}`, reason: null }] : [],
      }),
    ),
  });

  it('puts consecutive unlabelled steps a node height plus the Authored rank gap apart', () => {
    const { nodes } = layoutWorkflowGraph(chain(3));

    expect(nodes[1]?.position.y).toBe((nodes[0]?.position.y ?? 0) + 60 + RANK_GAP);
    expect(nodes[2]?.position.y).toBe((nodes[1]?.position.y ?? 0) + 60 + RANK_GAP);
  });

  it('grows only the gap under a step with labels, by a label height per label', () => {
    const definition = chain(3);
    definition.steps[1] = step({
      name: 's1',
      transitions: [
        { status: 'failed', target: 's2', reason: null },
        { status: 'rejected', target: 's0', reason: null },
      ],
    });
    const { nodes } = layoutWorkflowGraph(definition);

    expect(nodes[1]?.position.y).toBe((nodes[0]?.position.y ?? 0) + 60 + RANK_GAP);
    expect(nodes[2]?.position.y).toBe((nodes[1]?.position.y ?? 0) + 60 + RANK_GAP + 2 * 18);
  });

  it('keeps a 17-step chain under 2400px tall', () => {
    const { nodes } = layoutWorkflowGraph(chain(17));
    const bottom = Math.max(...nodes.map((node) => node.position.y)) + 60;

    expect(bottom).toBeLessThan(2400);
  });

  it('labels each kind of transition, and only a plain success goes unlabelled', () => {
    const reasons = ['CHALLENGE_EXPIRED', 'CHALLENGE_NOT_FOUND'];
    const definition = chain(6);
    definition.steps[0] = step({
      name: 's0',
      transitions: [
        { status: 'rejected', target: 's1', reason: reasons },
        { status: 'rejected', target: 's2', reason: null },
      ],
    });
    definition.steps[1] = step({
      name: 's1',
      transitions: [
        { status: 'success', target: 's2', when: { field: 'a', equals: 'x' }, reason: null },
      ],
    });
    definition.steps[2] = step({
      name: 's2',
      transitions: [{ status: 'retry', target: 's3', reason: null }],
    });
    definition.steps[3] = step({
      name: 's3',
      transitions: [{ status: 'success', target: 's4', reason: null }],
    });
    const { edges } = layoutWorkflowGraph(definition);
    const conditionOf = (source: string, target: string) =>
      edges.find((candidate) => candidate.source === source && candidate.target === target)?.data;

    expect(conditionOf('s0', 's1')?.condition).toBe(
      'rejected · CHALLENGE_EXPIRED, CHALLENGE_NOT_FOUND',
    );
    expect(conditionOf('s0', 's2')?.condition).toBe('rejected · fallback');
    expect(conditionOf('s1', 's2')?.condition).toBe('a = x');
    expect(conditionOf('s1', 's2')?.label).toBe('success when a = x');
    expect(conditionOf('s2', 's3')?.condition).toBe('retry');
    expect(conditionOf('s3', 's4')?.label).toBe('');
    expect(conditionOf('s3', 's4')?.labelPosition).toBeNull();
    expect(conditionOf('s1', 's2')?.displayLabel).not.toContain('\n');
  });

  it('labels manual review actions, with the condition after the action', () => {
    const definition = chain(4);
    definition.steps[0] = step({
      name: 's0',
      transitions: [{ status: 'manual.approve', target: 's1', reason: null }],
    });
    definition.steps[1] = step({
      name: 's1',
      transitions: [
        {
          status: 'manual.reject',
          target: 's2',
          when: { field: 'a', equals: 'x' },
          reason: null,
        },
      ],
    });
    definition.steps[2] = step({
      name: 's2',
      transitions: [{ status: 'rejected', target: 's3', reason: ['LOCKED'] }],
    });
    const { edges } = layoutWorkflowGraph(definition);

    expect(edges[0]?.data?.displayLabel).toBe('approve');
    expect(edges[0]?.data?.label).toBe('manual.approve');
    expect(edges[1]?.data?.displayLabel).toBe('reject · a = x');
    expect(edges[2]?.data?.displayLabel).toBe('rejected · LOCKED');
  });

  it('caps a long condition and keeps the full text', () => {
    const definition = chain(2);
    definition.steps[0] = step({
      name: 's0',
      transitions: [
        {
          status: 'success',
          target: 's1',
          when: { field: 'someVeryLongFieldName', equals: 'SOME_LONG_VALUE' },
          reason: null,
        },
      ],
    });
    const edge = layoutWorkflowGraph(definition).edges[0];

    expect(edge?.data?.label).toContain('someVeryLongFieldName = SOME_LONG_VALUE');
    expect(edge?.data?.displayLabel.length).toBe(MAX_LABEL_CHARS);
    expect(edge?.data?.displayLabel.endsWith('…')).toBe(true);
  });
});

describe('layoutWorkflowGraph edge ports', () => {
  const fan: WorkflowDefinition = {
    workflowId: 'fan',
    workflowVersion: 1,
    name: null,
    initialStep: 'a',
    scores: {},
    webhook: null,
    steps: [
      step({
        name: 'a',
        transitions: [
          { status: 'success', target: 'b', reason: null },
          { status: 'rejected', target: 'c', reason: null },
        ],
      }),
      step({ name: 'b', transitions: [{ status: 'success', target: 'd', reason: null }] }),
      step({ name: 'c', transitions: [{ status: 'success', target: 'd', reason: null }] }),
      step({ name: 'd', terminal: true }),
    ],
  };
  const { nodes, edges } = layoutWorkflowGraph(fan);
  const nodeX = (id: string) => nodes.find((node) => node.id === id)?.position.x ?? Number.NaN;
  const edge = (source: string, target: string) =>
    edges.find((candidate) => candidate.source === source && candidate.target === target);

  it('starts fanning edges in the left-to-right order of their targets', () => {
    const left = nodeX('b') < nodeX('c') ? 'b' : 'c';
    const right = left === 'b' ? 'c' : 'b';

    expect(edge('a', left)?.data?.points[0]?.x).toBeLessThan(
      edge('a', right)?.data?.points[0]?.x ?? Number.NaN,
    );
  });

  it('ends converging edges in the left-to-right order of their sources', () => {
    const left = nodeX('b') < nodeX('c') ? 'b' : 'c';
    const right = left === 'b' ? 'c' : 'b';
    const endX = (source: string) => edge(source, 'd')?.data?.points.at(-1)?.x ?? Number.NaN;

    expect(endX(left)).toBeLessThan(endX(right));
  });

  it('keeps a lone edge centred on its node', () => {
    const { nodes: chainNodes, edges: chainEdges } = layoutWorkflowGraph({
      ...fan,
      steps: [
        step({ name: 'a', transitions: [{ status: 'success', target: 'b', reason: null }] }),
        step({ name: 'b' }),
      ],
    });
    const centre = (chainNodes[0]?.position.x ?? 0) + 88;

    expect(chainEdges[0]?.data?.points[0]?.x).toBe(centre);
    expect(chainEdges[0]?.data?.points.at(-1)?.x).toBe(centre);
  });
});

describe('layoutWorkflowGraph edge cases', () => {
  const definitionOf = (
    initialStep: string,
    steps: WorkflowStepDefinition[],
  ): WorkflowDefinition => ({
    ...DEFINITION,
    initialStep,
    steps,
  });
  const yOf = (nodes: readonly WorkflowStepNode[], id: string): number =>
    nodes.find((node) => node.id === id)?.position.y ?? Number.NaN;

  it('orders the exits of a step by where each edge heads, so none of them cross', () => {
    const { edges } = layoutWorkflowGraph(
      definitionOf('a', [
        step({ name: 'a', transitions: [{ status: 'success', target: 'b', reason: null }] }),
        step({ name: 'b', transitions: [{ status: 'success', target: 'c', reason: null }] }),
        step({
          name: 'c',
          transitions: [
            { status: 'success', target: 'done', reason: null },
            { status: 'retry', target: 'a', reason: null },
            { status: 'failed', target: 'b', reason: null },
          ],
        }),
        step({ name: 'done', status: 'approved', terminal: true }),
      ]),
    );
    const leaving = edges.filter((edge) => edge.source === 'c');
    // Where each edge first moves sideways to, below the step.
    const headingOf = (points: { x: number }[]) =>
      points.find((point) => point.x !== points[0]!.x)?.x ?? points[0]!.x;
    const byExit = [...leaving].sort(
      (a, b) => (a.data?.points[0]?.x ?? 0) - (b.data?.points[0]?.x ?? 0),
    );
    const byHeading = [...leaving].sort(
      (a, b) => headingOf(a.data?.points ?? []) - headingOf(b.data?.points ?? []),
    );

    expect(leaving).toHaveLength(3);
    expect(byExit.map((edge) => edge.id)).toEqual(byHeading.map((edge) => edge.id));
  });

  it('still terminates and places every step when the workflow declares a cycle', () => {
    const { nodes } = layoutWorkflowGraph(
      definitionOf('a', [
        step({ name: 'a', transitions: [{ status: 'success', target: 'b', reason: null }] }),
        step({ name: 'b', transitions: [{ status: 'success', target: 'a', reason: null }] }),
      ]),
    );

    expect(nodes.map((node) => node.id)).toEqual(['a', 'b']);
  });

  it('keeps the initial step above every step reachable from it, loop or no loop', () => {
    const { nodes } = layoutWorkflowGraph(
      definitionOf('a', [
        step({ name: 'a', transitions: [{ status: 'success', target: 'b', reason: null }] }),
        step({ name: 'b', transitions: [{ status: 'success', target: 'c', reason: null }] }),
        step({ name: 'c', transitions: [{ status: 'success', target: 'a', reason: null }] }),
      ]),
    );

    expect(yOf(nodes, 'a')).toBeLessThan(yOf(nodes, 'b'));
    expect(yOf(nodes, 'b')).toBeLessThan(yOf(nodes, 'c'));
  });

  it('keeps a retry loop from pushing the steps it touches out of order', () => {
    const { nodes, edges } = layoutWorkflowGraph(
      definitionOf('collect', [
        step({
          name: 'collect',
          transitions: [{ status: 'success', target: 'verify', reason: null }],
        }),
        step({
          name: 'verify',
          status: 'awaiting_manual_review',
          transitions: [
            { status: 'manual.approve', target: 'approved', reason: null },
            { status: 'manual.reject', target: 'collect', reason: null },
          ],
        }),
        step({ name: 'approved', status: 'approved', terminal: true }),
      ]),
    );
    const between = edges.filter(
      (candidate) => [candidate.source, candidate.target].sort().join() === 'collect,verify',
    );

    expect(yOf(nodes, 'collect')).toBeLessThan(yOf(nodes, 'verify'));
    expect(yOf(nodes, 'verify')).toBeLessThan(yOf(nodes, 'approved'));
    expect(between).toHaveLength(2);
    expect(between.every((candidate) => candidate.markerStart === undefined)).toBe(true);
  });

  it('draws no node and no edge for a transition target no step declares', () => {
    const { nodes, edges } = layoutWorkflowGraph(
      definitionOf('collect', [
        step({
          name: 'collect',
          transitions: [
            { status: 'success', target: 'approved', reason: null },
            { status: 'error', target: 'no_such_step', reason: null },
          ],
        }),
        step({ name: 'approved', status: 'approved', terminal: true }),
      ]),
    );

    expect(nodes.map((node) => node.id)).toEqual(['collect', 'approved']);
    expect(edges.map((candidate) => candidate.id)).toEqual(['collect->approved']);
  });

  it('draws a workflow that declares no steps at all', () => {
    expect(layoutWorkflowGraph(definitionOf('collect', []))).toEqual({
      nodes: [],
      edges: [],
      groups: [],
    });
  });

  it('places a step nothing transitions to rather than dropping it', () => {
    const { nodes } = layoutWorkflowGraph({
      ...DEFINITION,
      steps: [...DEFINITION.steps, step({ name: 'stranded', status: 'invalid', terminal: true })],
    });
    const stranded = nodes.find((node) => node.id === 'stranded');

    expect(Number.isFinite(stranded?.position.x)).toBe(true);
    expect(Number.isFinite(stranded?.position.y)).toBe(true);
  });
});

describe('layoutWorkflowGraph for a workflow that loops back and skips a rank', () => {
  // A straight line would cut through `c` for `b->d` and through `b` for the `c->a` retry.
  const { nodes, edges } = layoutWorkflowGraph({
    ...DEFINITION,
    initialStep: 'a',
    steps: [
      step({ name: 'a', transitions: [{ status: 'success', target: 'b', reason: null }] }),
      step({
        name: 'b',
        transitions: [
          { status: 'success', target: 'c', when: { field: 'x', equals: 'y' }, reason: null },
          { status: 'success', target: 'd', reason: null },
        ],
      }),
      step({
        name: 'c',
        transitions: [
          { status: 'success', target: 'd', reason: null },
          { status: 'retry', target: 'a', reason: null },
        ],
      }),
      step({ name: 'd', status: 'approved', terminal: true }),
    ],
  });
  const edge = (source: string, target: string) =>
    edges.find((candidate) => candidate.source === source && candidate.target === target);

  it('never draws an edge across a node it is not attached to', () => {
    for (const drawn of edges) {
      const points = drawn.data?.points ?? [];
      // Every point along each segment, a pixel apart, so a crossing between bends is caught too.
      const traced = points.slice(1).flatMap((to, index) => {
        const from = points[index]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
        return Array.from({ length: steps + 1 }, (_, at) => ({
          x: from.x + ((to.x - from.x) * at) / steps,
          y: from.y + ((to.y - from.y) * at) / steps,
        }));
      });

      for (const node of nodes) {
        if (node.id === drawn.source || node.id === drawn.target) continue;

        const crossings = traced.filter(
          (point) =>
            point.x > node.position.x &&
            point.x < node.position.x + NODE_WIDTH &&
            point.y > node.position.y &&
            point.y < node.position.y + NODE_HEIGHT,
        );

        expect(crossings, `${drawn.id} crosses ${node.id}`).toEqual([]);
      }
    }
  });

  it('leaves a one-way transition with a single arrowhead', () => {
    const oneWay = edge('b', 'd');

    expect(oneWay?.markerStart).toBeUndefined();
    expect(oneWay?.markerEnd).toBeDefined();
  });
});

describe('layoutWorkflowGraph groups', () => {
  const otp = { step: 'send_code', type: 'otp-verify', category: 'verify' };
  const grouped: WorkflowDefinition = {
    ...DEFINITION,
    initialStep: 'collect',
    steps: [
      step({
        name: 'collect',
        source: { step: 'collect', type: 'form', category: 'collect' },
        transitions: [{ status: 'success', target: 'send_code', reason: null }],
      }),
      step({
        name: 'send_code',
        source: otp,
        transitions: [{ status: 'success', target: 'verify_code', reason: null }],
      }),
      step({
        name: 'verify_code',
        source: otp,
        transitions: [
          { status: 'success', target: 'approved', reason: null },
          { status: 'rejected', target: 'resend_code', reason: null },
        ],
      }),
      step({
        name: 'resend_code',
        source: otp,
        transitions: [{ status: 'success', target: 'verify_code', reason: null }],
      }),
      step({ name: 'approved', status: 'approved', terminal: true }),
    ],
  };

  it('frames only an authored step that compiled to several steps, around every one of them', () => {
    const { nodes, groups } = layoutWorkflowGraph(grouped);

    expect(groups.map((group) => group.data)).toEqual([
      expect.objectContaining({ step: 'send_code', type: 'otp-verify', category: 'verify' }),
    ]);
    const [frame] = groups;
    for (const name of ['send_code', 'verify_code', 'resend_code']) {
      const node = nodes.find((candidate) => candidate.id === name)!;
      expect(node.position.x).toBeGreaterThan(frame!.position.x);
      expect(node.position.y).toBeGreaterThan(frame!.position.y);
      expect(node.position.x + NODE_WIDTH).toBeLessThan(frame!.position.x + frame!.data.width);
      expect(node.position.y + NODE_HEIGHT).toBeLessThan(frame!.position.y + frame!.data.height);
    }
  });

  it('tints a node by its source category, and leaves it untinted without a source', () => {
    const { nodes } = layoutWorkflowGraph(grouped);

    expect(nodes.find((node) => node.id === 'collect')?.data.category).toBe('collect');
    expect(nodes.find((node) => node.id === 'approved')?.data.category).toBeNull();
  });

  it('draws no frame when every authored step compiled to one step', () => {
    expect(layoutWorkflowGraph(DEFINITION).groups).toEqual([]);
  });
});

describe('placeLabels', () => {
  const node = (id: string, x: number, y: number) =>
    ({ id, position: { x, y }, data: {} }) as unknown as WorkflowStepNode;
  const edge = (
    id: string,
    points: Array<[number, number]>,
    label: { at: [number, number]; text: string } | null = null,
  ) =>
    ({
      id,
      source: 'verify',
      target: id,
      data: {
        points: points.map(([x, y]) => ({ x, y })),
        labelPosition: label === null ? null : { x: label.at[0], y: label.at[1] },
        label: label?.text ?? '',
        condition: label?.text ?? '',
        displayLabel: label?.text ?? '',
        dashed: false,
      },
    }) as unknown as WorkflowGraphEdge;

  it('moves a label seeded on a sibling edge along its own edge until the box is clear', () => {
    const nodes = [node('verify', 0, 0), node('resend', 200, 300), node('rejected', 0, 600)];
    const sibling = edge('rejected', [
      [70, 60],
      [70, 600],
    ]);
    // The label starts on the sibling's vertical line.
    const labelled = edge(
      'resend',
      [
        [88, 60],
        [288, 300],
      ],
      { at: [80, 80], text: 'rejected · CHALLENGE' },
    );
    const [, placed] = placeLabels([sibling, labelled], nodes, new Map());
    const centre = placed?.data?.labelPosition;
    const { width } = labelBox('rejected · CHALLENGE');

    expect(centre).not.toBeNull();
    expect(Math.abs((centre?.x ?? 0) - 70)).toBeGreaterThanOrEqual(width / 2);
  });
});
