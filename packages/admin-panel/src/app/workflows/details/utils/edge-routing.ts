// How each edge runs: every horizontal run sits in a gap between rows, at a height of its own.
import type { ProjectedEdge } from './authored-projection';
import type { EdgePoint } from './workflow-edge-path';
import { RANK_GAP } from './canvas-layout';
import {
  HALF,
  listPortCenters,
  nodeHeight,
  nodeWidth,
  type GeometryNode,
} from './step-node-geometry';

/** How far an edge runs straight out of its port, or into its target, before turning. */
export const EDGE_OFFSET = 16;
/** How far a planned column may slide to get past a step in its way. */
const COLUMN_SLIDE = 120;
/** Between neighbouring runs, entries and lanes. */
const LANE_GAP = 10;
/** Between the graph's side and its first outer lane. */
const LANE_MARGIN = 40;
/** How close a vertical run may pass a step it does not touch. */
const STEP_CLEARANCE = 4;
/** Rows closer than this have no room to turn between: a plain step line. */
const MIN_TURN_GAP = EDGE_OFFSET + EDGE_OFFSET;
/** Between neighbouring entries on one target. */
const ENTRY_STEP = LANE_GAP + LANE_GAP;
/** Entries spread over at most this share of the target's top edge. */
const ENTRY_SPAN_SHARE = 0.7;

/** The corners an edge passes: out of its port, across at `dropY`, along `laneX`, across at `turnY`. */
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

/** How an edge runs: `direct`, `early`, along an outer `lane`, or a plain `step` line. */
type Shape = 'direct' | 'early' | 'lane' | 'step';

interface Span {
  top: number;
  bottom: number;
}

/** A horizontal run's two ends, and whether the vertical meeting each end lies above it. */
interface RunEnds {
  from: { x: number; above: boolean };
  to: { x: number; above: boolean };
}

interface Run extends RunEnds {
  edge: RouteLine;
  which: 'dropY' | 'turnY';
  /** The top of the row below the gap the run sits in. */
  rowTop: number;
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

/** `count` evenly spaced values from `low` to `high`; a single one sits in the middle. */
function spread(count: number, low: number, high: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    count === 1 ? (low + high) * HALF : low + ((high - low) * index) / (count - 1),
  );
}

const overlaps = (a: Span, b: Span): boolean => a.top < b.bottom && b.top < a.bottom;

/** Runs sharing a gap, top to bottom, ordered so no vertical crosses another run. */
function orderRuns<T extends RunEnds>(runs: readonly T[]): T[] {
  const isInside = (x: number, run: T): boolean =>
    x > Math.min(run.from.x, run.to.x) && x < Math.max(run.from.x, run.to.x);
  const mustBeAbove = (a: T, b: T): boolean =>
    [a.from, a.to].some((end) => end.above && isInside(end.x, b)) ||
    [b.from, b.to].some((end) => !end.above && isInside(end.x, a));
  const remaining = [...runs].sort((a, b) => a.from.x - b.from.x);
  const ordered: T[] = [];
  while (remaining.length > 0) {
    const blockers = remaining.map(
      (run) => remaining.filter((other) => other !== run && mustBeAbove(other, run)).length,
    );
    ordered.push(...remaining.splice(blockers.indexOf(Math.min(...blockers)), 1));
  }
  return ordered;
}

/** A step's box as the router reads it. */
export interface RouteBox {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

/** An edge as the router reads it: its two steps, and where along its source's bottom it leaves. */
export interface RouteLine {
  id: string;
  source: string;
  target: string;
  portX: number;
  /** Columns the layout kept free for this edge through the rows it skips, best first. */
  columnXs?: number[];
}

/** The Authored graph's edges, routed from the port each one leaves. */
export function routeEdges(
  nodes: GeometryNode[],
  edges: ProjectedEdge[],
  back: Set<string>,
): Map<string, EdgeRoute> {
  const byName = new Map(nodes.map((node) => [node.id, node]));
  const lines = edges.flatMap((edge): RouteLine[] => {
    const source = byName.get(edge.source);
    if (edge.dangling || source === undefined) return [];
    const port = listPortCenters(source.data).find((center) => center.name === edge.handle);
    const portX = source.position.x + (port?.x ?? nodeWidth(source.data) * HALF);
    return [{ id: edge.id, source: edge.source, target: edge.target, portX }];
  });
  const boxes = nodes.map((node) => ({
    id: node.id,
    position: node.position,
    width: nodeWidth(node.data),
    height: nodeHeight(node.data),
  }));
  return routeLines(boxes, lines, back);
}

/** How tall the gap under and over each row is. */
export interface RowSpacing {
  /** The height of the gap under the row whose tallest step ends at `rowBottom`. */
  gapBelow: (rowBottom: number) => number;
  /** The height of the gap over the row whose steps start at `rowTop`. */
  gapAbove: (rowTop: number) => number;
}

/** Every gap `RANK_GAP` tall: the Authored canvas's rows. */
const EVEN_ROWS: RowSpacing = { gapBelow: () => RANK_GAP, gapAbove: () => RANK_GAP };

/** Routes every edge between boxes laid out in rows; see `EdgeRoute`. */
export function routeLines(
  nodes: RouteBox[],
  edges: RouteLine[],
  back: Set<string>,
  { gapBelow, gapAbove }: RowSpacing = EVEN_ROWS,
): Map<string, EdgeRoute> {
  const byName = new Map(nodes.map((node) => [node.id, node]));
  const drawn = edges.filter((edge) => byName.has(edge.source) && byName.has(edge.target));
  const source = (edge: RouteLine): RouteBox => byName.get(edge.source)!;
  const target = (edge: RouteLine): RouteBox => byName.get(edge.target)!;
  // Measured once per call: the checks below read every node's box many times per edge.
  const boxes = new Map(
    nodes.map((node) => {
      const { width } = node;
      const row = { top: node.position.y, bottom: node.position.y + node.height };
      return [
        node,
        { right: node.position.x + width, centre: node.position.x + width * HALF, row },
      ];
    }),
  );
  const leftOf = (node: RouteBox): number => node.position.x;
  const rightOf = (node: RouteBox): number => boxes.get(node)!.right;
  const centreOf = (node: RouteBox): number => boxes.get(node)!.centre;
  const rowOf = (node: RouteBox): Span => boxes.get(node)!.row;
  // Steps sharing a top edge form a row; the gap below it starts under its tallest step.
  const rowBottoms = new Map<number, number>();
  for (const node of nodes) {
    const { top, bottom } = rowOf(node);
    rowBottoms.set(top, Math.max(rowBottoms.get(top) ?? bottom, bottom));
  }
  const rowBottomOf = (node: RouteBox): number => rowBottoms.get(node.position.y)!;
  const portX = (edge: RouteLine): number => edge.portX;
  /** The rows a vertical run covers: between the two steps, or for a loop, the gaps around them. */
  const spans = new Map(
    drawn.map((edge): [RouteLine, Span] => [
      edge,
      back.has(edge.id)
        ? {
            top: rowOf(target(edge)).top - gapAbove(rowOf(target(edge)).top),
            bottom: rowBottomOf(source(edge)) + gapBelow(rowBottomOf(source(edge))),
          }
        : { top: rowOf(source(edge)).bottom, bottom: rowOf(target(edge)).top },
    ]),
  );
  const spanOf = (edge: RouteLine): Span => spans.get(edge)!;
  /** Whether a vertical run at `x` down the edge's span misses every step but its own two. */
  const isClear = (edge: RouteLine, x: number): boolean =>
    nodes.every(
      (node) =>
        node.id === edge.source ||
        node.id === edge.target ||
        x <= leftOf(node) - STEP_CLEARANCE ||
        x >= rightOf(node) + STEP_CLEARANCE ||
        !overlaps(spanOf(edge), rowOf(node)),
    );

  /**
   * The first column the layout planned for the edge that misses every other step, slid just past
   * a step in the way. A loop's column climbs from below its source to above its target, so it
   * must miss both of them too.
   */
  const columnOf = (
    edge: RouteLine,
    isTaken: (x: number) => boolean = () => false,
  ): number | undefined => {
    const findBlocker = (x: number): RouteBox | undefined =>
      nodes.find(
        (node) =>
          ((node.id !== edge.source && node.id !== edge.target) || back.has(edge.id)) &&
          x > leftOf(node) - STEP_CLEARANCE &&
          x < rightOf(node) + STEP_CLEARANCE &&
          overlaps(spanOf(edge), rowOf(node)),
      );
    for (const planned of edge.columnXs ?? []) {
      for (const side of [1, -1] as const) {
        let x = planned;
        for (
          let blocker = findBlocker(x);
          Math.abs(x - planned) <= COLUMN_SLIDE;
          blocker = findBlocker(x)
        ) {
          if (blocker === undefined && !isTaken(x)) return x;
          if (blocker === undefined) x += side * LANE_GAP;
          else x = side === 1 ? rightOf(blocker) + LANE_GAP : leftOf(blocker) - LANE_GAP;
        }
      }
    }
    return undefined;
  };

  // Each edge takes the first shape that fits; retry loops always go outside.
  const shapes = new Map(
    drawn.map((edge): [string, Shape] => {
      const { top, bottom } = spanOf(edge);
      const column = columnOf(edge);
      if (back.has(edge.id)) return [edge.id, 'lane'];
      if (bottom - top < MIN_TURN_GAP) return [edge.id, 'step'];
      // A planned column off to the side beats dropping straight down and crossing over at the end.
      if (column !== undefined && Math.abs(column - portX(edge)) > COLUMN_SLIDE) {
        return [edge.id, 'lane'];
      }
      if (isClear(edge, portX(edge))) return [edge.id, 'direct'];
      if (column !== undefined) return [edge.id, 'lane'];
      if (isClear(edge, centreOf(target(edge)))) return [edge.id, 'early'];
      return [edge.id, 'lane'];
    }),
  );
  const routes = new Map<string, EdgeRoute>(
    drawn.map((edge) => [edge.id, { entryOffset: 0, dropY: null, laneX: null, turnY: null }]),
  );

  // Outer lanes take the first free gap out from the port and nest by length; `side` is 1 right, -1 left.
  const pickLaneX = (
    edge: RouteLine,
    side: 1 | -1,
    isTaken: (x: number) => boolean = () => false,
  ): number => {
    const beside = nodes.filter((node) => overlaps(spanOf(edge), rowOf(node)));
    const findBlocker = (x: number): RouteBox | undefined =>
      beside.find((node) => x > leftOf(node) - LANE_MARGIN && x < rightOf(node) + LANE_MARGIN);
    let x = portX(edge);
    for (
      let blocker = findBlocker(x);
      blocker !== undefined || isTaken(x);
      blocker = findBlocker(x)
    ) {
      if (blocker === undefined) x += side * LANE_GAP;
      else x = side === 1 ? rightOf(blocker) + LANE_MARGIN : leftOf(blocker) - LANE_MARGIN;
    }
    return x;
  };
  // The side with the shorter trip to the lane; retry loops keep to the right.
  const travelVia = (edge: RouteLine, side: 1 | -1): number => {
    const lane = pickLaneX(edge, side);
    return Math.abs(lane - portX(edge)) + Math.abs(lane - centreOf(target(edge)));
  };
  const sideOf = (edge: RouteLine): 1 | -1 =>
    back.has(edge.id) || travelVia(edge, 1) <= travelVia(edge, -1) ? 1 : -1;
  const lengthOf = (edge: RouteLine): number => spanOf(edge).bottom - spanOf(edge).top;
  const verticals = drawn.flatMap((edge) => {
    const shape = shapes.get(edge.id);
    if (shape === 'direct') return [{ id: edge.id, x: portX(edge), ...spanOf(edge) }];
    if (shape === 'early') return [{ id: edge.id, x: centreOf(target(edge)), ...spanOf(edge) }];
    return [];
  });
  const laned = drawn.filter((edge) => shapes.get(edge.id) === 'lane');
  // A lane down a column the layout kept free stays there; the rest find their own outside.
  // Claimed one at a time, so no two share an x where their spans meet.
  const columns: (Span & { x: number })[] = [];
  const columned = new Set<RouteLine>();
  for (const edge of laned) {
    const span = spanOf(edge);
    const x = columnOf(edge, (candidate) =>
      [...columns, ...verticals].some(
        (run) => Math.abs(run.x - candidate) < LANE_GAP && overlaps(span, run),
      ),
    );
    if (x === undefined) continue;
    columns.push({ x, ...span });
    columned.add(edge);
    routes.get(edge.id)!.laneX = x;
  }
  for (const side of [1, -1] as const) {
    const placed: (Span & { x: number })[] = [...columns];
    const onSide = laned
      .filter((edge) => !columned.has(edge) && sideOf(edge) === side)
      .sort((a, b) => lengthOf(a) - lengthOf(b) || side * (portX(b) - portX(a)));
    for (const edge of onSide) {
      const span = spanOf(edge);
      const isTaken = (x: number): boolean =>
        [...placed, ...verticals].some(
          (run) => Math.abs(run.x - x) < LANE_GAP && overlaps(span, run),
        );
      const x = pickLaneX(edge, side, isTaken);
      placed.push({ x, ...span });
      routes.get(edge.id)!.laneX = x;
    }
  }
  const approachX = (edge: RouteLine): number => routes.get(edge.id)!.laneX ?? portX(edge);

  const isBetween = (x: number, a: number, b: number): boolean =>
    x > Math.min(a, b) && x < Math.max(a, b);
  const lanes = laned.map((edge) => ({
    id: edge.id,
    x: routes.get(edge.id)!.laneX!,
    ...spanOf(edge),
  }));

  // Entries spread along the target's top edge in the order edges approach it. An early turn comes
  // down at its own entry, so it takes whichever slot crosses the fewest other lines.
  for (const incoming of groupBy(drawn, (edge) => edge.target).values()) {
    const { width } = target(incoming[0]!);
    const centre = centreOf(target(incoming[0]!));
    const offsetsFor = (count: number): number[] => {
      const span = Math.min(width * ENTRY_SPAN_SHARE, (count - 1) * ENTRY_STEP);
      return spread(count, -span * HALF, span * HALF);
    };
    const isEarly = (edge: RouteLine): boolean => shapes.get(edge.id) === 'early';
    let sorted = incoming
      .filter((edge) => !isEarly(edge))
      .sort((a, b) => approachX(a) - approachX(b));
    for (const early of incoming.filter(isEarly).sort((a, b) => portX(a) - portX(b))) {
      const dropY = rowBottomOf(source(early)) + EDGE_OFFSET;
      const countCrossings = (order: RouteLine[]): number => {
        const offsets = offsetsFor(order.length);
        const entryOf = (edge: RouteLine): number => centre + offsets[order.indexOf(edge)]!;
        const x = entryOf(early);
        // Turns into the target that would pass this edge's vertical...
        const turns = order.filter(
          (other) =>
            other !== early && !isEarly(other) && isBetween(x, approachX(other), entryOf(other)),
        ).length;
        // ...and lines through the gap under its source that its drop would cut.
        const cuts = [...verticals, ...lanes].filter(
          (line) =>
            line.id !== early.id &&
            line.top <= dropY &&
            line.bottom > dropY &&
            isBetween(line.x, x, portX(early)),
        ).length;
        return turns + cuts;
      };
      const candidates = Array.from({ length: sorted.length + 1 }, (_, index) => [
        ...sorted.slice(0, index),
        early,
        ...sorted.slice(index),
      ]);
      const scores = candidates.map(countCrossings);
      sorted = candidates[scores.indexOf(Math.min(...scores))]!;
    }
    // Shifted sideways when an entry would sit on a line passing through the gap above the target.
    const above = target(sorted[0]!).position.y - EDGE_OFFSET;
    const passing = [...verticals, ...lanes].filter(
      (line) => line.top < above && line.bottom > above,
    );
    const lands = (offsets: number[]): boolean =>
      sorted.some((edge, index) =>
        passing.some(
          (line) =>
            line.id !== edge.id && Math.abs(line.x - (centre + offsets[index]!)) < LANE_GAP * HALF,
        ),
      );
    const spreadOffsets = offsetsFor(sorted.length);
    const shifts = [0, LANE_GAP * HALF, -LANE_GAP * HALF, LANE_GAP, -LANE_GAP];
    const shift = shifts.find((by) => !lands(spreadOffsets.map((offset) => offset + by))) ?? 0;
    const offsets = spreadOffsets.map((offset) => offset + shift);
    sorted.forEach((edge, index) => (routes.get(edge.id)!.entryOffset = offsets[index]!));
  }

  // The horizontal runs: below the source (`dropY`) and above the target (`turnY`).
  const runs = drawn.flatMap((edge): Run[] => {
    const port = { x: portX(edge), above: true };
    const entry = { x: centreOf(target(edge)) + routes.get(edge.id)!.entryOffset, above: false };
    const drop = (to: Run['to']): Run => ({
      edge,
      which: 'dropY',
      rowTop: rowBottomOf(source(edge)) + gapBelow(rowBottomOf(source(edge))),
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

  // Each gap gives every run its own height.
  for (const [rowTop, inGap] of groupBy(runs, (run) => run.rowTop)) {
    const ordered = orderRuns(inGap);
    const heights = spread(
      ordered.length,
      rowTop - gapAbove(rowTop) + EDGE_OFFSET,
      rowTop - EDGE_OFFSET,
    );
    ordered.forEach((run, index) => (routes.get(run.edge.id)![run.which] = heights[index]!));
  }

  return routes;
}

/** The corners an edge passes, as its route lays them out; see `EdgeRoute`. */
export function listRoutePoints(
  source: EdgePoint,
  target: EdgePoint,
  route: EdgeRoute,
): EdgePoint[] {
  const points = [source];
  if (route.dropY !== null) points.push({ x: source.x, y: route.dropY });
  if (route.laneX !== null && route.turnY !== null) {
    points.push({ x: route.laneX, y: route.dropY ?? source.y }, { x: route.laneX, y: route.turnY });
  } else if (route.turnY !== null) {
    points.push({ x: source.x, y: route.turnY });
  }
  points.push({ x: target.x, y: points[points.length - 1]!.y }, target);
  return points.filter(
    (point, index) =>
      index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y,
  );
}
