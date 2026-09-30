import { describe, expect, it } from 'vitest';
import type {
  WorkflowDefinition,
  WorkflowStepDefinition,
} from '@/api/workflows/workflow-definitions';
import {
  labelBox,
  layoutWorkflowGraph,
  placeLabels,
  MAX_LABEL_CHARS,
  spreadEdgePorts,
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

  it('merges a pair joined both ways into one edge with two arrowheads', () => {
    const merged = edges.filter(
      (candidate) => [candidate.source, candidate.target].sort().join() === 'collect,verify',
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.markerStart).toBeDefined();
    expect(merged[0]?.markerEnd).toBeDefined();
  });

  it('draws a non-success edge dashed and a success edge solid', () => {
    expect(edge('verify', 'review')?.style?.strokeDasharray).toBe('5 4');
    expect(edge('collect', 'review')?.style?.strokeDasharray).toBeUndefined();
  });

  it('labels a guarded edge and its fallback arm, and leaves a plain success edge unlabelled', () => {
    expect(edge('collect', 'verify')?.data?.label).toContain('success when a = x');
    // The pair is joined both ways, so the retry back to `collect` is on the same line.
    expect(edge('collect', 'verify')?.data?.condition).toBe('a = x · success · fallback · retry');
    expect(edge('collect', 'review')?.data?.condition).toBe('success · fallback');
    expect(edge('verify', 'approved')?.data?.label).toBe('');
  });

  it('takes a label position from dagre for a labelled edge only', () => {
    const labelled = edge('collect', 'verify')?.data?.labelPosition;

    expect(labelled).not.toBeNull();
    expect(labelled?.y).toBeGreaterThan(byId('collect')?.position.y ?? Number.NaN);
    expect(edge('verify', 'approved')?.data?.labelPosition).toBeNull();
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

  it('puts consecutive unlabelled steps a node height plus 64px apart', () => {
    const { nodes } = layoutWorkflowGraph(chain(3));

    expect(nodes[1]?.position.y).toBe((nodes[0]?.position.y ?? 0) + 60 + 64);
    expect(nodes[2]?.position.y).toBe((nodes[1]?.position.y ?? 0) + 60 + 64);
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

describe('spreadEdgePorts', () => {
  const node = (id: string, x: number, y: number) =>
    ({ id, position: { x, y }, data: {} }) as unknown as WorkflowStepNode;
  const edge = (source: string, target: string, points: Array<[number, number]>) =>
    ({
      id: `${source}>${target}`,
      source,
      target,
      data: {
        points: points.map(([x, y]) => ({ x, y })),
        labelPosition: null,
        label: '',
        condition: '',
        displayLabel: '',
        dashed: false,
      },
    }) as unknown as WorkflowGraphEdge;
  const pointsOf = (edges: WorkflowGraphEdge[], id: string) =>
    edges.find((candidate) => candidate.id === id)?.data?.points ?? [];

  it('sorts a multi-rank edge by the side it approaches from, not by its far node', () => {
    const nodes = [node('target', 0, 400), node('far', 1000, 0), node('near', 600, 300)];
    const edges = spreadEdgePorts(
      [
        // Far to the right, but it bends in from the left of the target.
        edge('far', 'target', [
          [1088, 60],
          [-200, 160],
          [-250, 300],
          [88, 400],
        ]),
        edge('near', 'target', [
          [688, 360],
          [88, 400],
        ]),
      ],
      nodes,
      new Map(),
    );

    expect(pointsOf(edges, 'far>target').at(-1)?.x).toBeLessThan(
      pointsOf(edges, 'near>target').at(-1)?.x ?? Number.NaN,
    );
  });

  it('leaves a back edge from its source top and enters the target bottom, stubs outward', () => {
    const nodes = [node('target', 0, 0), node('source', 0, 300)];
    const [back] = spreadEdgePorts(
      [
        edge('source', 'target', [
          [88, 300],
          [88, 60],
        ]),
      ],
      nodes,
      new Map(),
    );
    const points = back?.data?.points ?? [];

    expect(points[0]).toEqual({ x: 88, y: 300 });
    expect(points[1]?.y).toBeLessThan(300);
    expect(points.at(-1)).toEqual({ x: 88, y: 60 });
    expect(points.at(-2)?.y).toBeGreaterThan(60);
  });

  it('adds no stub when the neighbouring point is close', () => {
    const nodes = [node('target', 0, 0), node('source', 0, 80)];
    const [short] = spreadEdgePorts(
      [
        edge('source', 'target', [
          [88, 80],
          [88, 60],
        ]),
      ],
      nodes,
      new Map(),
    );

    expect(short?.data?.points).toHaveLength(2);
  });
});

describe('layoutWorkflowGraph label placement', () => {
  // Mirrors `verify_phone_code`: three edges leave one node's bottom, one of them labelled.
  const definition: WorkflowDefinition = {
    workflowId: 'siblings',
    workflowVersion: 1,
    name: null,
    initialStep: 'verify',
    scores: {},
    webhook: null,
    steps: [
      step({
        name: 'verify',
        transitions: [
          { status: 'success', target: 'personal', reason: null },
          {
            status: 'rejected',
            target: 'resend',
            reason: ['CHALLENGE_EXPIRED', 'CHALLENGE_NOT_FOUND'],
          },
          { status: 'rejected', target: 'rejected', reason: null },
        ],
      }),
      step({
        name: 'resend',
        transitions: [{ status: 'success', target: 'verify', reason: null }],
      }),
      step({
        name: 'personal',
        transitions: [{ status: 'success', target: 'purpose', reason: null }],
      }),
      step({
        name: 'purpose',
        transitions: [{ status: 'success', target: 'review', reason: null }],
      }),
      step({
        name: 'review',
        transitions: [{ status: 'manual.reject', target: 'rejected', reason: null }],
      }),
      step({ name: 'rejected', status: 'rejected', terminal: true }),
    ],
  };

  it('keeps a label box off the sibling edges leaving the same node', () => {
    const { edges } = layoutWorkflowGraph(definition);
    const labelled = edges.find((candidate) =>
      candidate.data?.condition.startsWith('rejected · CHALLENGE'),
    );
    const centre = labelled?.data?.labelPosition;
    const { width, height } = labelBox(labelled?.data?.displayLabel ?? '');
    const inside = (x: number, y: number) =>
      centre != null && Math.abs(x - centre.x) < width / 2 && Math.abs(y - centre.y) < height / 2;
    const siblings = edges.filter(
      (candidate) => candidate.id !== labelled?.id && candidate.source === 'verify',
    );

    expect(centre).not.toBeNull();
    expect(siblings.length).toBeGreaterThan(1);
    for (const sibling of siblings) {
      const points = sibling.data?.points ?? [];
      for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1]!;
        const to = points[index]!;
        for (let step = 0; step <= 50; step += 1) {
          const x = from.x + ((to.x - from.x) * step) / 50;
          const y = from.y + ((to.y - from.y) * step) / 50;
          expect(inside(x, y)).toBe(false);
        }
      }
    }
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

describe('layoutWorkflowGraph merged pair labels', () => {
  it('puts a label carried only by the reverse direction on the drawn line', () => {
    const definition: WorkflowDefinition = {
      workflowId: 'pair',
      workflowVersion: 1,
      name: null,
      initialStep: 'a',
      scores: {},
      webhook: null,
      steps: [
        // `a` reaches `b` directly and through `m`, so the pair spans two ranks.
        step({
          name: 'a',
          transitions: [
            { status: 'success', target: 'm', reason: null },
            { status: 'success', target: 'b', reason: null },
          ],
        }),
        step({ name: 'm', transitions: [{ status: 'success', target: 'b', reason: null }] }),
        step({
          name: 'b',
          transitions: [
            { status: 'retry', target: 'a', reason: null },
            { status: 'success', target: 'c', reason: null },
          ],
        }),
        step({ name: 'c', terminal: true }),
      ],
    };
    const merged = layoutWorkflowGraph(definition).edges.find(
      (candidate) => candidate.source === 'a' && candidate.target === 'b',
    );
    const centre = merged?.data?.labelPosition;
    const points = merged?.data?.points ?? [];
    const distance = Math.min(
      ...points.slice(1).map((to, index) => {
        const from = points[index]!;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const lengthSquared = dx * dx + dy * dy || 1;
        const t = Math.max(
          0,
          Math.min(
            1,
            (((centre?.x ?? 0) - from.x) * dx + ((centre?.y ?? 0) - from.y) * dy) / lengthSquared,
          ),
        );
        return Math.hypot(
          (centre?.x ?? 0) - (from.x + t * dx),
          (centre?.y ?? 0) - (from.y + t * dy),
        );
      }),
    );

    expect(merged?.source).toBe('a');
    expect(merged?.data?.condition).toBe('retry');
    expect(centre).not.toBeNull();
    expect(distance).toBeLessThan(3);
  });
});
