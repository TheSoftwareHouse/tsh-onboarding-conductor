// PoC (throwaway): how each edge runs, so edges keep out of steps and off each other's lines. Every
// horizontal run sits in a gap between rows, where no step is, and gets its own height there.
import type { ProjectedEdge } from './authored-graph';
import { listPortCenters, nodeHeight, nodeWidth, type AuthoredStepNode } from './AuthoredStepNode';
import { RANK_GAP } from './canvas-layout';

/** How far an edge runs straight out of its port, or into its target, before turning. */
export const EDGE_OFFSET = 16;
/** Between neighbouring runs, entries and lanes. */
const LANE_GAP = 10;
/** Between the graph's side and its first outer lane. */
const LANE_MARGIN = 40;
/** How close a vertical run may pass a step it does not touch. */
const STEP_CLEARANCE = 4;
/** Entries spread over at most this share of the target's top edge. */
const ENTRY_SPAN_SHARE = 0.7;

/**
 * The corners an edge passes, top to bottom: down out of its port, across at `dropY` (and up or
 * down an outer lane at `laneX`), across at `turnY`, then down into its target. All `null` draws a
 * plain step line.
 */
export interface EdgeRoute {
  /** From the target's centre to where this edge enters it. */
  entryOffset: number;
  /** A horizontal run in the gap below the source. */
  dropY: number | null;
  /** A vertical run outside the graph, for retry loops and edges no straight drop can reach. */
  laneX: number | null;
  /** A horizontal run in the gap above the target. */
  turnY: number | null;
}

/**
 * - `direct`: down under its port, across above the target.
 * - `early`: across below the source, down onto the target.
 * - `lane`: across below the source, along an outer lane, across above the target.
 * - `step`: rows too close to turn between; a plain step line.
 */
type Shape = 'direct' | 'early' | 'lane' | 'step';

interface Span {
  top: number;
  bottom: number;
}

/** A horizontal run, and whether the vertical meeting it at each end lies above it. */
interface Run {
  edge: ProjectedEdge;
  which: 'dropY' | 'turnY';
  /** The top of the row below the gap the run sits in. */
  rowTop: number;
  from: { x: number; above: boolean };
  to: { x: number; above: boolean };
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

/** `count` evenly spaced values from `low` to `high`; a single one sits in the middle. */
function spread(count: number, low: number, high: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    count === 1 ? (low + high) / 2 : low + ((high - low) * index) / (count - 1),
  );
}

const overlaps = (a: Span, b: Span): boolean => a.top < b.bottom && b.top < a.bottom;

export function routeEdges(
  nodes: AuthoredStepNode[],
  edges: ProjectedEdge[],
  back: Set<string>,
): Map<string, EdgeRoute> {
  const byName = new Map(nodes.map((node) => [node.id, node]));
  const drawn = edges.filter(
    (edge) => !edge.dangling && byName.has(edge.source) && byName.has(edge.target),
  );
  const source = (edge: ProjectedEdge): AuthoredStepNode => byName.get(edge.source)!;
  const target = (edge: ProjectedEdge): AuthoredStepNode => byName.get(edge.target)!;
  const leftOf = (node: AuthoredStepNode): number => node.position.x;
  const rightOf = (node: AuthoredStepNode): number => node.position.x + nodeWidth(node.data);
  const centreOf = (node: AuthoredStepNode): number => node.position.x + nodeWidth(node.data) / 2;
  const rowOf = (node: AuthoredStepNode): Span => ({
    top: node.position.y,
    bottom: node.position.y + nodeHeight(node.data),
  });
  // Steps sharing a top edge form a row; the gap below it starts under its tallest step, so a short
  // step's runs share the gap with its neighbours' instead of passing beside a taller one.
  const rowBottoms = new Map<number, number>();
  for (const node of nodes) {
    const { top, bottom } = rowOf(node);
    rowBottoms.set(top, Math.max(rowBottoms.get(top) ?? bottom, bottom));
  }
  const rowBottomOf = (node: AuthoredStepNode): number => rowBottoms.get(node.position.y)!;
  const portX = (edge: ProjectedEdge): number => {
    const port = listPortCenters(source(edge).data).find((center) => center.name === edge.handle);
    return source(edge).position.x + (port?.x ?? nodeWidth(source(edge).data) / 2);
  };
  /** The rows a vertical run covers: between the two steps, or for a loop, the gaps around them. */
  const spanOf = (edge: ProjectedEdge): Span =>
    back.has(edge.id)
      ? { top: rowOf(target(edge)).top - RANK_GAP, bottom: rowBottomOf(source(edge)) + RANK_GAP }
      : { top: rowOf(source(edge)).bottom, bottom: rowOf(target(edge)).top };
  /** Whether a vertical run at `x` down the edge's span misses every step but its own two. */
  const isClear = (edge: ProjectedEdge, x: number): boolean =>
    nodes.every(
      (node) =>
        node.id === edge.source ||
        node.id === edge.target ||
        x <= leftOf(node) - STEP_CLEARANCE ||
        x >= rightOf(node) + STEP_CLEARANCE ||
        !overlaps(spanOf(edge), rowOf(node)),
    );

  // Each edge takes the first shape that fits; retry loops always go outside.
  const shapes = new Map(
    drawn.map((edge): [string, Shape] => {
      const { top, bottom } = spanOf(edge);
      if (back.has(edge.id)) return [edge.id, 'lane'];
      if (bottom - top < EDGE_OFFSET * 2) return [edge.id, 'step'];
      if (isClear(edge, portX(edge))) return [edge.id, 'direct'];
      if (isClear(edge, centreOf(target(edge)))) return [edge.id, 'early'];
      return [edge.id, 'lane'];
    }),
  );
  const routes = new Map<string, EdgeRoute>(
    drawn.map((edge) => [edge.id, { entryOffset: 0, dropY: null, laneX: null, turnY: null }]),
  );

  // Outer lanes hug the steps in the rows they pass, not the whole graph, and nest by length: the
  // shortest lane goes innermost, so a lane that stops sooner never turns across one still running,
  // and a retry loop stays inside a long edge. A lane steps outward past any run it would land on.
  // `side` is 1 for the right, -1 for the left.
  const findLaneBase = (edge: ProjectedEdge, side: 1 | -1): number => {
    const beside = nodes.filter((node) => overlaps(spanOf(edge), rowOf(node)));
    const sides = beside.map((node) => (side === 1 ? rightOf(node) : leftOf(node)));
    return side === 1
      ? Math.max(portX(edge), ...sides) + LANE_MARGIN
      : Math.min(portX(edge), ...sides) - LANE_MARGIN;
  };
  // The side with the shorter trip out to the lane and back in to the target; retry loops keep to
  // the right, so every "go back" reads the same way.
  const travelVia = (edge: ProjectedEdge, side: 1 | -1): number => {
    const lane = findLaneBase(edge, side);
    return Math.abs(lane - portX(edge)) + Math.abs(lane - centreOf(target(edge)));
  };
  const sideOf = (edge: ProjectedEdge): 1 | -1 =>
    back.has(edge.id) || travelVia(edge, 1) <= travelVia(edge, -1) ? 1 : -1;
  const lengthOf = (edge: ProjectedEdge): number => spanOf(edge).bottom - spanOf(edge).top;
  const verticals = drawn.flatMap((edge) => {
    const shape = shapes.get(edge.id);
    if (shape === 'direct') return [{ x: portX(edge), ...spanOf(edge) }];
    if (shape === 'early') return [{ x: centreOf(target(edge)), ...spanOf(edge) }];
    return [];
  });
  const laned = drawn.filter((edge) => shapes.get(edge.id) === 'lane');
  for (const side of [1, -1] as const) {
    const placed: (Span & { x: number })[] = [];
    const onSide = laned
      .filter((edge) => sideOf(edge) === side)
      .sort((a, b) => lengthOf(a) - lengthOf(b) || side * (portX(b) - portX(a)));
    for (const edge of onSide) {
      const span = spanOf(edge);
      const isTaken = (x: number): boolean =>
        [...placed, ...verticals].some(
          (run) => Math.abs(run.x - x) < LANE_GAP && overlaps(span, run),
        );
      let x = findLaneBase(edge, side);
      while (isTaken(x)) x += side * LANE_GAP;
      placed.push({ x, ...span });
      routes.get(edge.id)!.laneX = x;
    }
  }
  const approachX = (edge: ProjectedEdge): number => routes.get(edge.id)!.laneX ?? portX(edge);

  // Entries spread along the target's top edge in the order edges approach it.
  for (const incoming of groupBy(drawn, (edge) => edge.target).values()) {
    const sorted = [...incoming].sort((a, b) => approachX(a) - approachX(b));
    const width = nodeWidth(target(sorted[0]!).data);
    const span = Math.min(width * ENTRY_SPAN_SHARE, (sorted.length - 1) * LANE_GAP * 2);
    const offsets = spread(sorted.length, -span / 2, span / 2);
    sorted.forEach((edge, index) => (routes.get(edge.id)!.entryOffset = offsets[index]!));
  }

  // The horizontal runs: in the gap below the source (`dropY`) and the one above the target
  // (`turnY`). A retry loop climbs its lane, so its lane meets the drop from above and the turn
  // from below; any other lane runs down.
  const runs = drawn.flatMap((edge): Run[] => {
    const port = { x: portX(edge), above: true };
    const entry = { x: centreOf(target(edge)) + routes.get(edge.id)!.entryOffset, above: false };
    const drop = (to: Run['to']): Run => ({
      edge,
      which: 'dropY',
      rowTop: rowBottomOf(source(edge)) + RANK_GAP,
      from: port,
      to,
    });
    const turn = (from: Run['from']): Run => ({
      edge,
      which: 'turnY',
      rowTop: rowOf(target(edge)).top,
      from,
      to: entry,
    });
    const lane = routes.get(edge.id)!.laneX!;
    const climbs = back.has(edge.id);
    switch (shapes.get(edge.id)) {
      case 'direct':
        return [turn(port)];
      case 'early':
        return [drop(entry)];
      case 'lane':
        return [drop({ x: lane, above: climbs }), turn({ x: lane, above: !climbs })];
      default:
        return [];
    }
  });

  // Each gap gives every run in it its own height, ordered so no vertical crosses another run: a
  // vertical arriving from above inside another run's span puts its run above that one, and one
  // leaving downward puts it below. Next is the run nothing left must sit above; in a cycle, the
  // one with the fewest. Ties keep left-to-right order.
  const isInside = (x: number, run: Run): boolean =>
    x > Math.min(run.from.x, run.to.x) && x < Math.max(run.from.x, run.to.x);
  const mustBeAbove = (a: Run, b: Run): boolean =>
    [a.from, a.to].some((end) => end.above && isInside(end.x, b)) ||
    [b.from, b.to].some((end) => !end.above && isInside(end.x, a));
  for (const [rowTop, inGap] of groupBy(runs, (run) => run.rowTop)) {
    const remaining = [...inGap].sort((a, b) => a.from.x - b.from.x);
    const ordered: Run[] = [];
    while (remaining.length > 0) {
      const blockers = remaining.map(
        (run) => remaining.filter((other) => other !== run && mustBeAbove(other, run)).length,
      );
      ordered.push(...remaining.splice(blockers.indexOf(Math.min(...blockers)), 1));
    }
    const heights = spread(ordered.length, rowTop - RANK_GAP + EDGE_OFFSET, rowTop - EDGE_OFFSET);
    ordered.forEach((run, index) => (routes.get(run.edge.id)![run.which] = heights[index]!));
  }

  return routes;
}
