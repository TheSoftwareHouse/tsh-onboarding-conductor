import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import type {
  WorkflowDefinition,
  WorkflowStepDefinition,
  WorkflowTransitionDefinition,
} from '@/api/workflows/workflow-definitions';
import { describeCondition } from './describe-condition';
import { describeTransition, isFallbackArm } from './describe-transition';
import { isSelfTransition } from './is-self-transition';
import { pluralize } from './pluralize';
import { HALF } from './step-node-geometry';
import { findEdgeMidpoint, type EdgePoint } from './workflow-edge-path';

/** Node box size, fixed so dagre ranks steps without measuring the DOM. */
export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 60;

/** Height of each line a node carries beyond its name and subtitle. */
const EXTRA_LINE_HEIGHT = 14;

/** A step declaring more transitions than this says how many it has. */
const TRANSITION_COUNT_THRESHOLD = 3;

/** Ids of the arrowhead `<marker>`s `WorkflowGraph` defines: solid for `success` edges, light for the rest. */
export const ARROW_MARKER_ID = 'wf-ar';
export const DASHED_ARROW_MARKER_ID = 'wf-ar-l';

const arrowId = (dashed: boolean): string => (dashed ? DASHED_ARROW_MARKER_ID : ARROW_MARKER_ID);

/** Statuses a reviewer's action fires are `manual.<action>`, labelled with the action alone. */
const MANUAL_PREFIX = 'manual.';

/** Label box estimate handed to dagre: mono 11px is about 6.6px a character. */
export const MAX_LABEL_CHARS = 22;
const LABEL_CHAR_WIDTH = 6.6;
const LABEL_PADDING = 12;
const LABEL_HEIGHT = 18;

/** dagre spacing: between siblings on a rank, between ranks, and around the drawing. */
const NODE_GAP = 48;
const RANK_GAP = 64;
const DRAWING_MARGIN = 32;

const EDGE_STROKE_WIDTH = 1.5;
/** Dash and gap lengths of a non-`success` edge. */
const EDGE_DASH = '5 4';

const EDGE_COLOR = 'var(--color-fg-2)';
const DASHED_EDGE_COLOR = 'var(--color-fg-4)';

/** A `type`, not an `interface`: React Flow's `Node<TData>` needs `Record<string, unknown>`. */
export type WorkflowNodeData = {
  name: string;
  status: string;
  terminal: boolean;
  subtitle: string;
  /** Set only when the step declares more transitions than the threshold. */
  transitionCount: number | null;
  /** Statuses of the transitions onto the step itself, drawn as lines rather than edges. */
  selfTransitions: string[];
  /** The authored step type's category, for the node's tint; null when the engine sent no source. */
  category: string | null;
};

/** A frame around the compiled steps one authored step produced, drawn only when it produced several. */
export type WorkflowGroupData = {
  /** The authored step name. */
  step: string;
  type: string;
  category: string;
  width: number;
  height: number;
};

export type WorkflowGroupNode = Node<WorkflowGroupData, 'workflowGroup'>;

export type WorkflowEdgeData = {
  /** The route dagre laid the edge along, in the same coordinate space as the node positions. */
  points: EdgePoint[];
  /** Centre of the label box dagre reserved room for, or null when the edge has no label. */
  labelPosition: EdgePoint | null;
  /** The full rules of the edge's guarded transitions, for the tooltip; empty when none is guarded. */
  label: string;
  /** The guard conditions alone, joined, before any cut. */
  condition: string;
  /** The condition cut to `MAX_LABEL_CHARS`: what is drawn and what dagre reserved room for. */
  displayLabel: string;
  dashed: boolean;
};

export type WorkflowStepNode = Node<WorkflowNodeData, 'workflowStep'>;
export type WorkflowGraphEdge = Edge<WorkflowEdgeData, 'workflowTransition'>;

export interface WorkflowGraph {
  nodes: WorkflowStepNode[];
  edges: WorkflowGraphEdge[];
  groups: WorkflowGroupNode[];
}

const GROUP_ID_PREFIX = 'group:';

/** Cuts a label to the width dagre reserves for it; the full text stays in `data.label`. */
export function truncateLabel(label: string): string {
  return label.length <= MAX_LABEL_CHARS ? label : `${label.slice(0, MAX_LABEL_CHARS - 1)}…`;
}

/** The one-line box a drawn label occupies, which is what dagre reserves room for. */
export function labelBox(displayLabel: string): { width: number; height: number } {
  return { width: displayLabel.length * LABEL_CHAR_WIDTH + LABEL_PADDING, height: LABEL_HEIGHT };
}

/** What an edge says for one transition; empty for a plain, unguarded `success`. */
function describeEdgeLabel(
  step: WorkflowStepDefinition,
  transition: WorkflowTransitionDefinition,
): string {
  const manual = transition.status.startsWith(MANUAL_PREFIX);
  const condition = transition.when != null ? describeCondition(transition.when) : null;
  const reasons = transition.reason?.length ? transition.reason.join(', ') : null;
  const fallback = isFallbackArm(step, transition);
  // `success` is implied by a guard alone, so only the condition is shown.
  const impliedSuccess = transition.status === 'success' && condition !== null && reasons === null;
  const status = manual ? transition.status.slice(MANUAL_PREFIX.length) : transition.status;
  const plain = transition.status === 'success' && condition === null && reasons === null;

  if (plain && !fallback) return '';

  return [impliedSuccess ? null : status, condition, reasons, fallback ? 'fallback' : null]
    .filter((part) => part !== null && part !== '')
    .join(' · ');
}

function describeSubtitle(step: WorkflowStepDefinition): string {
  if (step.terminal) return 'terminal';

  const [connector] = step.connectors;
  if (connector !== undefined) {
    return [
      connector.id,
      connector.async ? 'async' : null,
      connector.canReject ? 'canReject' : null,
    ]
      .filter((part) => part !== null)
      .join(' · ');
  }

  return step.fields.length === 0
    ? step.status
    : `${step.status} · ${pluralize(step.fields.length, 'field')}`;
}

const nodeHeight = (data: WorkflowNodeData): number =>
  NODE_HEIGHT +
  EXTRA_LINE_HEIGHT * ((data.transitionCount === null ? 0 : 1) + data.selfTransitions.length);

/** Both directions between one pair of steps, whichever way round they were declared. */
const pairKey = (edge: WorkflowGraphEdge): string =>
  [edge.source, edge.target].sort().join('\u0000');

const markerColor = (dashed: boolean): string => (dashed ? DASHED_EDGE_COLOR : EDGE_COLOR);

const edgeStyle = (color: string, dashed: boolean): WorkflowGraphEdge['style'] => ({
  stroke: color,
  strokeWidth: EDGE_STROKE_WIDTH,
  strokeDasharray: dashed ? EDGE_DASH : undefined,
});

/** The label seed on the drawn route: its own dagre spot, else the drawn route's midpoint. */
function mergedLabelPosition(
  drawn: WorkflowGraphEdge,
  opposed: WorkflowGraphEdge,
): EdgePoint | null {
  if (drawn.data?.labelPosition != null) return drawn.data.labelPosition;
  if (opposed.data?.labelPosition == null) return null;
  const points = drawn.data?.points ?? [];
  return points.length > 0 ? findEdgeMidpoint(points) : opposed.data.labelPosition;
}

/** Collapses a step pair joined both ways into one line with an arrowhead at each end. */
function mergeOpposedEdges(edges: readonly WorkflowGraphEdge[]): WorkflowGraphEdge[] {
  const byPair = new Map<string, WorkflowGraphEdge[]>();
  for (const edge of edges) {
    const key = pairKey(edge);
    byPair.set(key, [...(byPair.get(key) ?? []), edge]);
  }

  const merged = new Set<string>();
  const result: WorkflowGraphEdge[] = [];

  for (const edge of edges) {
    const pair = byPair.get(pairKey(edge)) ?? [];
    const opposed = pair.find((candidate) => candidate.source === edge.target);

    if (pair.length !== 2 || opposed === undefined) {
      result.push(edge);
      continue;
    }

    if (merged.has(pairKey(edge))) continue;
    merged.add(pairKey(edge));

    const dashed = (edge.data?.dashed ?? false) || (opposed.data?.dashed ?? false);
    const joined = (pick: (data: WorkflowEdgeData) => string): string =>
      [edge.data, opposed.data]
        .map((data) => (data === undefined ? '' : pick(data)))
        .filter((part) => part !== '')
        .join(' · ');
    const label = joined((data) => data.label);
    const condition = joined((data) => data.condition);
    const color = markerColor(dashed);

    result.push({
      ...edge,
      id: `${edge.id}+${opposed.id}`,
      style: edgeStyle(color, dashed),
      markerStart: arrowId(dashed),
      markerEnd: arrowId(dashed),
      data: {
        points: edge.data?.points ?? [],
        labelPosition: mergedLabelPosition(edge, opposed),
        label,
        condition,
        displayLabel: truncateLabel(condition),
        dashed,
      },
    });
  }

  return result;
}

/** Exit and entry points spread over this share of a node's edge, at least `MIN_PORT_GAP` apart. */
const PORT_SPAN_SHARE = 0.7;
const MIN_PORT_GAP = 16;

/** Length of the straight run an edge keeps as it leaves or enters a node. */
const PORT_STUB = 12;

interface PortEnd {
  edge: WorkflowGraphEdge;
  end: 'start' | 'end';
  /** Where the end's neighbour lies, which decides its place in the order along the side. */
  towardsX: number;
  /** The far node's centre, breaking ties. */
  farX: number;
  /** The point next to the end on the drawn path. */
  neighbour: EdgePoint;
}

/** Spreads edge ends along each node side in approach order, so edges never cross at a node. */
export function spreadEdgePorts(
  edges: readonly WorkflowGraphEdge[],
  nodes: readonly WorkflowStepNode[],
  heights: ReadonlyMap<string, number>,
): WorkflowGraphEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const centreX = (id: string): number => (nodeById.get(id)?.position.x ?? 0) + NODE_WIDTH / 2;
  const height = (id: string): number => heights.get(id) ?? NODE_HEIGHT;
  const groups = new Map<string, PortEnd[]>();

  // An unlabelled one-rank edge runs straight, since dagre's spacer bend would cross reordered ends.
  const straightened = edges.map((edge) => {
    const points = edge.data?.points ?? [];
    const spacerOnly = points.length === 3 && edge.data?.label === '';

    return spacerOnly
      ? { ...edge, data: { ...edge.data!, points: [points[0]!, points[2]!] } }
      : edge;
  });

  for (const edge of straightened) {
    const points = edge.data?.points ?? [];
    if (points.length < 2) continue;
    const bends = points.length > 3;

    const ends: Array<['start' | 'end', string, string, EdgePoint]> = [
      ['start', edge.source, edge.target, points[1]!],
      ['end', edge.target, edge.source, points[points.length - 2]!],
    ];

    for (const [end, nodeId, farId, neighbour] of ends) {
      const node = nodeById.get(nodeId);
      if (node === undefined) continue;
      const side = neighbour.y < node.position.y + height(nodeId) / 2 ? 'top' : 'bottom';
      const towardsX = bends ? neighbour.x : centreX(farId);
      const key = `${nodeId}\u0000${side}`;
      groups.set(key, [
        ...(groups.get(key) ?? []),
        { edge, end, towardsX, farX: centreX(farId), neighbour },
      ]);
    }
  }

  const rewritten = new Map<string, EdgePoint[]>(
    straightened.map((edge) => [edge.id, [...(edge.data?.points ?? [])]]),
  );

  for (const [key, ports] of groups) {
    const [nodeId, side] = key.split('\u0000');
    const node = nodeById.get(nodeId!)!;
    const centre = centreX(nodeId!);
    const sorted = [...ports].sort((a, b) => a.towardsX - b.towardsX || a.farX - b.farX);
    const span = Math.min(NODE_WIDTH * PORT_SPAN_SHARE, (sorted.length - 1) * MIN_PORT_GAP);
    const y = side === 'top' ? node.position.y : node.position.y + height(nodeId!);
    const outward = side === 'top' ? -1 : 1;

    sorted.forEach(({ edge, end, neighbour }, index) => {
      const points = rewritten.get(edge.id) ?? [];
      const x =
        sorted.length === 1 ? centre : centre - span / 2 + (span * index) / (sorted.length - 1);
      const port = { x, y };
      const stub = { x, y: y + outward * PORT_STUB };
      const roomy = Math.hypot(neighbour.x - x, neighbour.y - y) >= PORT_STUB * 2;

      if (end === 'start') points.splice(0, 1, port, ...(roomy ? [stub] : []));
      else points.splice(points.length - 1, 1, ...(roomy ? [stub] : []), port);
    });
  }

  return straightened.map((edge) => {
    const original = edge.data?.points ?? [];
    let points = rewritten.get(edge.id) ?? [];
    let labelPosition = edge.data?.labelPosition ?? null;

    // A labelled one-rank edge bends halfway between its reordered ports, and its label follows.
    if (original.length === 3) {
      const spacer = original[1]!;
      const index = points.findIndex((point) => point.x === spacer.x && point.y === spacer.y);
      if (index > 0) {
        const bend = { x: (points[0]!.x + points[points.length - 1]!.x) / 2, y: spacer.y };
        points = points.map((point, at) => (at === index ? bend : point));
        if (labelPosition !== null) labelPosition = { x: bend.x, y: labelPosition.y };
      }
    }

    return { ...edge, data: { ...(edge.data as WorkflowEdgeData), points, labelPosition } };
  });
}

/** Characters an expanded label wraps at, matching the edge's `32ch` hover width. */
const EXPANDED_LINE_CHARS = 32;
const EXPANDED_LINE_HEIGHT = 14;

/** The stretch of an edge next to a node that an expanded label must leave clear. */
const PORT_CLEARANCE = 20;

/** Gap kept between a label and a node box. */
const NODE_CLEARANCE = 2;

/** A seed further than this from the drawn route is not tried, so a label never floats off its line. */
const ON_LINE_TOLERANCE = 1;

/** Fractions along an edge tried in turn, middle first. */
const LABEL_STOPS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.15, 0.85, 0.1, 0.9];

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const boxAround = (centre: EdgePoint, width: number, height: number): Box => ({
  left: centre.x - width / 2,
  right: centre.x + width / 2,
  top: centre.y - height / 2,
  bottom: centre.y + height / 2,
});

const boxesMeet = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Whether a segment passes through a box, by clipping it to the box (Liang–Barsky). */
function segmentMeetsBox(from: EdgePoint, to: EdgePoint, box: Box): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let enter = 0;
  let leave = 1;
  const edges: Array<[number, number]> = [
    [-dx, from.x - box.left],
    [dx, box.right - from.x],
    [-dy, from.y - box.top],
    [dy, box.bottom - from.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    if (enter > leave) return false;
  }
  return true;
}

const polylineMeetsBox = (points: readonly EdgePoint[], box: Box): boolean =>
  points.some((point, index) => index > 0 && segmentMeetsBox(points[index - 1]!, point, box));

/** The first and last `length` of a polyline, as two short polylines. */
function polylineEnds(points: readonly EdgePoint[], length: number): EdgePoint[][] {
  const walk = (list: readonly EdgePoint[]): EdgePoint[] => {
    const out = [list[0]!];
    let left = length;
    for (let index = 1; index < list.length && left > 0; index += 1) {
      const from = list[index - 1]!;
      const to = list[index]!;
      const segment = Math.hypot(to.x - from.x, to.y - from.y);
      const share = segment === 0 ? 1 : Math.min(1, left / segment);
      out.push({ x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share });
      left -= segment;
    }
    return out;
  };
  return points.length < 2 ? [] : [walk(points), walk([...points].reverse())];
}

/** The shortest distance from a point to a polyline. */
function distanceToPolyline(point: EdgePoint, points: readonly EdgePoint[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
          );
    nearest = Math.min(
      nearest,
      Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy)),
    );
  }
  return nearest;
}

/** The point `share` of the way along a polyline, by length. */
function pointAlong(points: readonly EdgePoint[], share: number): EdgePoint {
  const lengths = points.map((point, index) =>
    index === 0 ? 0 : Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y),
  );
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * share;
  for (let index = 1; index < points.length; index += 1) {
    const segment = lengths[index]!;
    if (segment >= remaining) {
      const from = points[index - 1]!;
      const to = points[index]!;
      const t = segment === 0 ? 0 : remaining / segment;
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    }
    remaining -= segment;
  }
  return points[points.length - 1]!;
}

/** Moves each label along its own edge to the first spot clear of nodes, labels and other edges. */
export function placeLabels(
  edges: readonly WorkflowGraphEdge[],
  nodes: readonly WorkflowStepNode[],
  heights: ReadonlyMap<string, number>,
): WorkflowGraphEdge[] {
  const nodeBoxes = nodes.map((node) => ({
    left: node.position.x - NODE_CLEARANCE,
    right: node.position.x + NODE_WIDTH + NODE_CLEARANCE,
    top: node.position.y - NODE_CLEARANCE,
    bottom: node.position.y + (heights.get(node.id) ?? NODE_HEIGHT) + NODE_CLEARANCE,
  }));
  const placed: Box[] = [];

  return edges.map((edge) => {
    const data = edge.data;
    const points = data?.points ?? [];
    if (data === undefined || data.labelPosition === null || points.length < 2) return edge;

    const others = edges.filter((other) => other.id !== edge.id);
    const otherLines = others.map((other) => other.data?.points ?? []);
    const otherEnds = otherLines.flatMap((line) => polylineEnds(line, PORT_CLEARANCE));
    const { width, height } = labelBox(data.displayLabel);
    const expandedChars = Math.min(data.condition.length, EXPANDED_LINE_CHARS);
    const expandedWidth = expandedChars * LABEL_CHAR_WIDTH + LABEL_PADDING;
    const expandedHeight =
      Math.ceil(data.condition.length / EXPANDED_LINE_CHARS) * EXPANDED_LINE_HEIGHT;

    const score = (centre: EdgePoint): number => {
      const box = boxAround(centre, width, height);
      if (nodeBoxes.some((node) => boxesMeet(box, node))) return 0;
      if (placed.some((label) => boxesMeet(box, label))) return 0;
      if (otherLines.some((line) => polylineMeetsBox(line, box))) return 1;
      const expanded = boxAround(centre, expandedWidth, expandedHeight);
      return otherEnds.some((line) => polylineMeetsBox(line, expanded)) ? 2 : 3;
    };

    const seed = data.labelPosition;
    const candidates = [
      ...(distanceToPolyline(seed, points) <= ON_LINE_TOLERANCE ? [seed] : []),
      ...LABEL_STOPS.map((share) => pointAlong(points, share)),
    ];
    let best = candidates[0]!;
    let bestScore = score(best);
    for (const candidate of candidates) {
      if (bestScore === 3) break;
      const candidateScore = score(candidate);
      if (candidateScore > bestScore) {
        best = candidate;
        bestScore = candidateScore;
      }
    }

    placed.push(boxAround(best, width, height));
    return { ...edge, data: { ...data, labelPosition: best } };
  });
}

/** Lays steps out top to bottom with dagre, one edge per ordered pair, drawn along dagre's points. */
export function layoutWorkflowGraph(definition: WorkflowDefinition): WorkflowGraph {
  const declared = new Set(definition.steps.map((step) => step.name));

  const datas = new Map<string, WorkflowNodeData>(
    definition.steps.map((step) => [
      step.name,
      {
        name: step.name,
        status: step.status,
        terminal: step.terminal,
        subtitle: describeSubtitle(step),
        transitionCount:
          step.transitions.length > TRANSITION_COUNT_THRESHOLD ? step.transitions.length : null,
        selfTransitions: step.transitions
          .filter((transition) => isSelfTransition(step, transition.target))
          .map((transition) => transition.status),
        category: step.source?.category ?? null,
      },
    ]),
  );

  // Authored steps that compiled to more than one step, each with the steps it produced.
  const bySource = new Map<string, WorkflowStepDefinition[]>();
  for (const step of definition.steps) {
    if (step.source === null) continue;
    bySource.set(step.source.step, [...(bySource.get(step.source.step) ?? []), step]);
  }
  const grouped = [...bySource.values()].filter((steps) => steps.length > 1);

  // One entry per ordered pair, carrying every transition that joins it.
  const pairs = new Map<
    string,
    { from: string; to: string; rules: string[]; conditions: string[]; dashed: boolean }
  >();
  for (const step of definition.steps) {
    for (const transition of step.transitions) {
      const { target } = transition;
      if (isSelfTransition(step, target) || target === null || !declared.has(target)) continue;

      const key = `${step.name}\u0000${target}`;
      const pair = pairs.get(key) ?? {
        from: step.name,
        to: target,
        rules: [],
        conditions: [],
        dashed: false,
      };
      const label = describeEdgeLabel(step, transition);
      if (label !== '') {
        pair.rules.push(describeTransition(step, transition));
        pair.conditions.push(label);
      }
      pair.dashed ||= transition.status !== 'success';
      pairs.set(key, pair);
    }
  }
  const transitions = [...pairs.values()].map((pair) => ({
    ...pair,
    id: `${pair.from}->${pair.to}`,
  }));

  // Multigraph, so the two directions between a pair stay distinct; compound only with a group.
  const graph = new dagre.graphlib.Graph({ multigraph: true, compound: grouped.length > 0 });
  graph.setGraph({
    rankdir: 'TB',
    nodesep: NODE_GAP,
    ranksep: RANK_GAP,
    marginx: DRAWING_MARGIN,
    marginy: DRAWING_MARGIN,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const step of definition.steps) {
    const data = datas.get(step.name);
    graph.setNode(step.name, {
      width: NODE_WIDTH,
      height: data === undefined ? NODE_HEIGHT : nodeHeight(data),
    });
  }
  // dagre sizes a parent to enclose its children with padding, which leaves room for the frame's label.
  for (const steps of grouped) {
    const groupId = `${GROUP_ID_PREFIX}${steps[0]!.source!.step}`;
    graph.setNode(groupId, {});
    for (const step of steps) graph.setParent(step.name, groupId);
  }
  for (const transition of transitions) {
    const label = truncateLabel(transition.conditions.join(' · '));
    const box = label === '' ? {} : { ...labelBox(label), labelpos: 'c' };
    graph.setEdge(transition.from, transition.to, box, transition.id);
  }
  dagre.layout(graph);

  const nodes: WorkflowStepNode[] = definition.steps.map((step) => {
    const { x, y, height } = graph.node(step.name);

    return {
      id: step.name,
      type: 'workflowStep',
      position: { x: x - NODE_WIDTH / 2, y: y - height / 2 },
      draggable: false,
      connectable: false,
      data: datas.get(step.name) as WorkflowNodeData,
    };
  });

  // Shifted so the drawing starts at (0, 0), which keeps one input laying out to one result.
  const minX = nodes.length === 0 ? 0 : Math.min(...nodes.map((node) => node.position.x));
  const minY = nodes.length === 0 ? 0 : Math.min(...nodes.map((node) => node.position.y));
  for (const node of nodes) {
    node.position.x -= minX;
    node.position.y -= minY;
  }

  const drawn: WorkflowGraphEdge[] = transitions.map(
    ({ id, from, to, rules, conditions, dashed }) => {
      const color = markerColor(dashed);
      const laidOut = graph.edge({ v: from, w: to, name: id });
      const points = (laidOut?.points ?? []).map((point: EdgePoint) => ({
        x: point.x - minX,
        y: point.y - minY,
      }));
      const labelPosition =
        rules.length > 0 && typeof laidOut?.x === 'number' && typeof laidOut.y === 'number'
          ? { x: laidOut.x - minX, y: laidOut.y - minY }
          : null;

      return {
        id,
        source: from,
        target: to,
        type: 'workflowTransition',
        style: edgeStyle(color, dashed),
        markerEnd: arrowId(dashed),
        data: {
          points,
          labelPosition,
          label: rules.join(' · '),
          condition: conditions.join(' · '),
          displayLabel: truncateLabel(conditions.join(' · ')),
          dashed,
        },
      };
    },
  );

  const heights = new Map(
    definition.steps.map((step) => [
      step.name,
      nodeHeight(datas.get(step.name) as WorkflowNodeData),
    ]),
  );

  const spread = spreadEdgePorts(mergeOpposedEdges(drawn), nodes, heights);

  const groups: WorkflowGroupNode[] = grouped.map((steps) => {
    const source = steps[0]!.source!;
    const id = `${GROUP_ID_PREFIX}${source.step}`;
    const { x, y, width, height } = graph.node(id);
    return {
      id,
      type: 'workflowGroup',
      position: { x: x - width * HALF - minX, y: y - height * HALF - minY },
      draggable: false,
      connectable: false,
      selectable: false,
      zIndex: -1,
      data: { step: source.step, type: source.type, category: source.category, width, height },
    };
  });

  return { nodes, edges: placeLabels(spread, nodes, heights), groups };
}
