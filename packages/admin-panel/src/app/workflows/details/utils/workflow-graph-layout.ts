import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import type {
  WorkflowDefinition,
  WorkflowStepDefinition,
  WorkflowTransitionDefinition,
} from '@/api/workflows/workflow-definitions';
import { describeCondition } from './describe-condition';
import { NODE_GAP, RANK_GAP } from './canvas-layout';
import { listRoutePoints, routeLines, type RouteBox } from './edge-routing';
import { describeTransition, isFallbackArm } from './describe-transition';
import { isSelfTransition } from './is-self-transition';
import { pluralize } from './pluralize';
import { HALF } from './step-node-geometry';
import type { EdgePoint } from './workflow-edge-path';

/** Node box size, fixed so dagre ranks steps without measuring the DOM. */
export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 60;

/** Height of each line a node carries beyond its name and subtitle. */
const EXTRA_LINE_HEIGHT = 14;

/** A step declaring more transitions than this says how many it has. */
const TRANSITION_COUNT_THRESHOLD = 3;

/** Ids of the arrowhead `<marker>`s `WorkflowGraph` defines: solid for edges going down, light for loops back. */
export const ARROW_MARKER_ID = 'wf-ar';
export const DASHED_ARROW_MARKER_ID = 'wf-ar-l';

const arrowId = (dashed: boolean): string => (dashed ? DASHED_ARROW_MARKER_ID : ARROW_MARKER_ID);

/** Statuses a reviewer's action fires are `manual.<action>`, labelled with the action alone. */
const MANUAL_PREFIX = 'manual.';

/** A drawn label is cut to this many characters; the full text shows on hover. */
export const MAX_LABEL_CHARS = 22;
/** Mono 11px is about 6.6px a character. */
const LABEL_CHAR_WIDTH = 6.6;
const LABEL_PADDING = 12;
const LABEL_HEIGHT = 18;

/** Room a group frame keeps around its steps, and above them for its title. */
const GROUP_PADDING = 12;
const GROUP_TITLE_HEIGHT = 24;

const EDGE_STROKE_WIDTH = 1.5;
/** Dash and gap lengths of a loop back. */
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
  /** The corners the edge's route passes, in the same coordinate space as the node positions. */
  points: EdgePoint[];
  /** The centre of the label, on the edge's own line; null when the edge has no label. */
  labelPosition: EdgePoint | null;
  /** The full rules of the edge's guarded transitions, for the tooltip; empty when none is guarded. */
  label: string;
  /** The guard conditions alone, joined, before any cut. */
  condition: string;
  /** The condition cut to `MAX_LABEL_CHARS`: what is drawn. */
  displayLabel: string;
  /** A loop back up to a step at or above its source, drawn dashed like the Authored graph's. */
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

/** The one-line box a drawn label occupies. */
export function labelBox(displayLabel: string): { width: number; height: number } {
  return { width: displayLabel.length * LABEL_CHAR_WIDTH + LABEL_PADDING, height: LABEL_HEIGHT };
}

/** Cuts a label to `MAX_LABEL_CHARS`; the full text stays in `data.label`. */
export function truncateLabel(label: string): string {
  return label.length <= MAX_LABEL_CHARS ? label : `${label.slice(0, MAX_LABEL_CHARS - 1)}…`;
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

export const nodeHeight = (data: WorkflowNodeData): number =>
  NODE_HEIGHT +
  EXTRA_LINE_HEIGHT * ((data.transitionCount === null ? 0 : 1) + data.selfTransitions.length);

const markerColor = (dashed: boolean): string => (dashed ? DASHED_EDGE_COLOR : EDGE_COLOR);

const edgeStyle = (color: string, dashed: boolean): WorkflowGraphEdge['style'] => ({
  stroke: color,
  strokeWidth: EDGE_STROKE_WIDTH,
  strokeDasharray: dashed ? EDGE_DASH : undefined,
});

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

/**
 * Lays steps out top to bottom with dagre and routes the edges the way the Authored graph does:
 * straight down from an exit on the source's bottom, across once in a gap, into the target's top,
 * and round an outer lane for a loop back.
 */
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
  const heights = new Map(
    definition.steps.map((step) => [
      step.name,
      nodeHeight(datas.get(step.name) as WorkflowNodeData),
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
    { from: string; to: string; rules: string[]; conditions: string[] }
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
      };
      const label = describeEdgeLabel(step, transition);
      if (label !== '') {
        pair.rules.push(describeTransition(step, transition));
        pair.conditions.push(label);
      }
      pairs.set(key, pair);
    }
  }
  const transitions = [...pairs.values()].map((pair) => ({
    ...pair,
    id: `${pair.from}->${pair.to}`,
  }));

  const outgoing = new Map<string, { id: string; target: string }[]>();
  for (const { id, from, to } of transitions) {
    outgoing.set(from, [...(outgoing.get(from) ?? []), { id, target: to }]);
  }

  // Multigraph, so the two directions between a pair stay distinct; compound only with a group.
  const graph = new dagre.graphlib.Graph({ multigraph: true, compound: grouped.length > 0 });
  graph.setGraph({ rankdir: 'TB', nodesep: NODE_GAP, ranksep: RANK_GAP });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const step of definition.steps) {
    graph.setNode(step.name, { width: NODE_WIDTH, height: heights.get(step.name) });
  }
  // A compound parent keeps the steps one authored step produced side by side.
  for (const steps of grouped) {
    const groupId = `${GROUP_ID_PREFIX}${steps[0]!.source!.step}`;
    graph.setNode(groupId, {});
    for (const step of steps) graph.setParent(step.name, groupId);
  }
  for (const transition of transitions) {
    graph.setEdge(transition.from, transition.to, {}, transition.id);
  }
  dagre.layout(graph);

  // Room for the labels of a step's edges, which have to find a clear spot along them.
  const labelRoomOf = (name: string): number =>
    transitions.filter((transition) => transition.from === name && transition.rules.length > 0)
      .length * LABEL_HEIGHT;

  // dagre ranks the steps; each rank becomes one top-aligned row, and each gap is `RANK_GAP` plus
  // room for the labels leaving the row above it, so only a gap with labels in it grows.
  const ranks = new Map<number, string[]>();
  for (const step of definition.steps) {
    const { y } = graph.node(step.name);
    ranks.set(y, [...(ranks.get(y) ?? []), step.name]);
  }
  const rowTops = new Map<number, number>();
  const gapsBelow = new Map<number, number>();
  const gapsAbove = new Map<number, number>();
  let top = 0;
  let previous: { bottom: number; gap: number } | null = null;
  for (const [y, names] of [...ranks].sort(([a], [b]) => a - b)) {
    if (previous !== null) {
      top = previous.bottom + previous.gap;
      gapsBelow.set(previous.bottom, previous.gap);
      gapsAbove.set(top, previous.gap);
    }
    rowTops.set(y, top);
    const bottom = top + Math.max(...names.map((name) => heights.get(name) ?? NODE_HEIGHT));
    previous = { bottom, gap: RANK_GAP + Math.max(...names.map(labelRoomOf)) };
  }

  const nodes: WorkflowStepNode[] = definition.steps.map((step) => {
    const { x, y } = graph.node(step.name);

    return {
      id: step.name,
      type: 'workflowStep',
      position: { x: x - NODE_WIDTH * HALF, y: rowTops.get(y)! },
      draggable: false,
      connectable: false,
      data: datas.get(step.name) as WorkflowNodeData,
    };
  });

  // Shifted so the drawing starts at x 0, which keeps one input laying out to one result.
  const minX = nodes.length === 0 ? 0 : Math.min(...nodes.map((node) => node.position.x));
  for (const node of nodes) node.position.x -= minX;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const heightOf = (id: string): number => heights.get(id) ?? NODE_HEIGHT;
  const centreX = (id: string): number => nodeById.get(id)!.position.x + NODE_WIDTH * HALF;

  const topOf = (id: string): number => nodeById.get(id)!.position.y;
  // Edges whose target is not below their source climb back up the drawing.
  const back = new Set(
    transitions.filter(({ from, to }) => topOf(to) <= topOf(from)).map(({ id }) => id),
  );

  // dagre threads an edge that skips rows down a column of its own; the router keeps it there.
  const rowIndex = new Map(
    [...new Set(nodes.map((node) => node.position.y))]
      .sort((a, b) => a - b)
      .map((top, index) => [top, index]),
  );
  const columnXs = new Map<string, number[]>();
  for (const { id, from, to } of transitions) {
    const skipped = Math.abs(rowIndex.get(topOf(to))! - rowIndex.get(topOf(from))!) - 1;
    const points: EdgePoint[] = graph.edge({ v: from, w: to, name: id })?.points ?? [];
    const xs = points.slice(1, -1).map((point) => point.x - minX);
    if (skipped < 1 || xs.length === 0) continue;
    // The middle of the run first, where an edge through several rows most likely stays.
    const middle = xs[Math.floor(xs.length / 2)]!;
    columnXs.set(
      id,
      [...xs].sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle)),
    );
  }

  // Exits share the source's bottom evenly, like ports, ordered so none cross: by where each edge
  // heads (its column, or its target), then loops with no column, which climb lanes on the right,
  // the longest (outermost) first.
  const portXs = new Map<string, number>();
  const headingX = (id: string, target: string): number =>
    columnXs.get(id)?.[0] ?? (back.has(id) ? Number.POSITIVE_INFINITY : centreX(target));
  for (const [source, leaving] of outgoing) {
    const sorted = [...leaving].sort(
      (a, b) =>
        headingX(a.id, a.target) - headingX(b.id, b.target) || topOf(a.target) - topOf(b.target),
    );
    const left = nodeById.get(source)!.position.x;
    sorted.forEach(({ id }, index) =>
      portXs.set(id, left + (NODE_WIDTH * (index + 1)) / (sorted.length + 1)),
    );
  }

  const boxes: RouteBox[] = nodes.map((node) => ({
    id: node.id,
    position: node.position,
    width: NODE_WIDTH,
    height: heightOf(node.id),
  }));
  const routes = routeLines(
    boxes,
    transitions.map(({ id, from, to }) => ({
      id,
      source: from,
      target: to,
      portX: portXs.get(id)!,
      columnXs: columnXs.get(id),
    })),
    back,
    {
      gapBelow: (rowBottom) => gapsBelow.get(rowBottom) ?? RANK_GAP,
      gapAbove: (rowTop) => gapsAbove.get(rowTop) ?? RANK_GAP,
    },
  );

  const edges: WorkflowGraphEdge[] = transitions.map(({ id, from, to, rules, conditions }) => {
    const dashed = back.has(id);
    const source = nodeById.get(from)!;
    const route = routes.get(id)!;
    const start = { x: portXs.get(id)!, y: source.position.y + heightOf(from) };
    const end = { x: centreX(to) + route.entryOffset, y: nodeById.get(to)!.position.y };
    // Rows too close to turn between still take one step, halfway.
    const turned =
      route.dropY === null && route.turnY === null && start.x !== end.x
        ? { ...route, turnY: (start.y + end.y) * HALF }
        : route;
    const points = listRoutePoints(start, end, turned);

    return {
      id,
      source: from,
      target: to,
      type: 'workflowTransition',
      style: edgeStyle(markerColor(dashed), dashed),
      markerEnd: arrowId(dashed),
      data: {
        points,
        // Seeded halfway along; `placeLabels` moves it to the first clear spot on the line.
        labelPosition: rules.length > 0 ? pointAlong(points, HALF) : null,
        label: rules.join(' · '),
        condition: conditions.join(' · '),
        displayLabel: truncateLabel(conditions.join(' · ')),
        dashed,
      },
    };
  });

  const groups: WorkflowGroupNode[] = grouped.map((steps) => {
    const source = steps[0]!.source!;
    const members = steps.map((step) => nodeById.get(step.name)!);
    const left = Math.min(...members.map((node) => node.position.x)) - GROUP_PADDING;
    const right = Math.max(...members.map((node) => node.position.x + NODE_WIDTH)) + GROUP_PADDING;
    const top = Math.min(...members.map((node) => node.position.y)) - GROUP_TITLE_HEIGHT;
    const bottom =
      Math.max(...members.map((node) => node.position.y + heightOf(node.id))) + GROUP_PADDING;
    return {
      id: `${GROUP_ID_PREFIX}${source.step}`,
      type: 'workflowGroup',
      position: { x: left, y: top },
      draggable: false,
      connectable: false,
      selectable: false,
      zIndex: -1,
      data: {
        step: source.step,
        type: source.type,
        category: source.category,
        width: right - left,
        height: bottom - top,
      },
    };
  });

  return { nodes, edges: placeLabels(edges, nodes, heights), groups };
}
