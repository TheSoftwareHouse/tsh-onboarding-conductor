import type { WorkflowDefinition } from '../types/workflow-definition';
import { describeAdminOnboardingStatusTone } from '../types/admin-onboarding';
import type { WorkflowPath } from './workflow-path';

/** Node box and spacing, fixed so the layout is computed rather than measured from the DOM. */
export const NODE_WIDTH = 248;
export const NODE_HEIGHT = 88;
const COLUMN_GAP = 40;
const ROW_GAP = 88;

/**
 * How far this onboarding got with a step, which is what the graph colours by. Deliberately about
 * the onboarding's progress rather than the step's declared status: the same step reads as
 * completed for one onboarding and as never taken for the next.
 */
export type WorkflowNodeState = 'completed' | 'current' | 'failed' | 'pending';

export interface WorkflowGraphNode {
  name: string;
  status: string;
  terminal: boolean;
  state: WorkflowNodeState;
  /** When the onboarding entered this step, or null if it never did. */
  enteredAt: string | null;
  /** Transitions the step declares onto itself, which are labels rather than edges. */
  selfTransitions: string[];
  x: number;
  y: number;
}

export interface WorkflowGraphEdge {
  id: string;
  from: string;
  to: string;
  /**
   * How the arrow is drawn: the state of the step it points at, so a line and its destination
   * read as one thing.
   *
   * Only an arrow leaving a step the onboarding completed carries that colour. One leaving a step
   * it never reached stays neutral however its destination is coloured, because colouring it
   * would claim a move that never happened.
   */
  tone: WorkflowNodeState;
  /** Elbow polyline, as `x,y` pairs from the source node's foot to the target node's head. */
  points: Array<[number, number]>;
}

/** How tightly an elbow is rounded off, in pixels. */
const CORNER_RADIUS = 10;

/**
 * Renders an elbow as an SVG path with its corners rounded off.
 *
 * A square corner where two lines cross reads as ambiguous: the eye follows the straighter
 * continuation rather than the turn, so an arrow that turns looks like it carries on. A rounded
 * corner is unmistakably a turn, which is what makes two crossing edges tellable apart.
 *
 * Every segment here is axis-aligned, so a corner is just a pull-back along the incoming segment,
 * a quadratic through the corner point, and a push-out along the outgoing one. The radius shrinks
 * for short segments so a corner never overshoots the segment it is cut from.
 */
export function toEdgePath(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length < 2) {
    return '';
  }

  const parts = [`M ${points[0][0]} ${points[0][1]}`];

  for (let index = 1; index < points.length - 1; index += 1) {
    const [previousX, previousY] = points[index - 1];
    const [cornerX, cornerY] = points[index];
    const [nextX, nextY] = points[index + 1];

    const incoming = Math.hypot(cornerX - previousX, cornerY - previousY);
    const outgoing = Math.hypot(nextX - cornerX, nextY - cornerY);
    const radius = Math.min(CORNER_RADIUS, incoming / 2, outgoing / 2);

    const enterX = cornerX - ((cornerX - previousX) / incoming) * radius;
    const enterY = cornerY - ((cornerY - previousY) / incoming) * radius;
    const leaveX = cornerX + ((nextX - cornerX) / outgoing) * radius;
    const leaveY = cornerY + ((nextY - cornerY) / outgoing) * radius;

    parts.push(`L ${enterX} ${enterY}`, `Q ${cornerX} ${cornerY} ${leaveX} ${leaveY}`);
  }

  const [lastX, lastY] = points[points.length - 1];
  parts.push(`L ${lastX} ${lastY}`);

  return parts.join(' ');
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  width: number;
  height: number;
}

/**
 * Longest-path depth of every step, measured from the initial one.
 *
 * Relaxed over bounded passes rather than a topological sort, because a workflow may declare a
 * cycle and no ordering exists then. A simple path visits each step at most once, so one pass per
 * step is enough for the depths to settle, and the bound is what stops a cycle looping forever.
 */
function measureDepths(definition: WorkflowDefinition): Map<string, number> {
  const depths = new Map<string, number>([[definition.initialStep, 0]]);

  for (let pass = 0; pass < definition.steps.length; pass += 1) {
    let changed = false;

    for (const step of definition.steps) {
      const depth = depths.get(step.name);

      if (depth === undefined) {
        continue;
      }

      for (const transition of step.transitions) {
        if (transition.target === null || transition.target === step.name) {
          continue;
        }

        if ((depths.get(transition.target) ?? -1) < depth + 1) {
          depths.set(transition.target, depth + 1);
          changed = true;
        }
      }
    }

    if (!changed) {
      break;
    }
  }

  // A step no transition reaches is still declared, so it is shown on a row of its own below the
  // rest rather than dropped from the picture.
  const unreachableDepth = Math.max(-1, ...depths.values()) + 1;
  for (const step of definition.steps) {
    if (!depths.has(step.name)) {
      depths.set(step.name, unreachableDepth);
    }
  }

  return depths;
}

function toNodeState(name: string, status: string, path: WorkflowPath): WorkflowNodeState {
  if (!path.enteredAt.has(name)) {
    return 'pending';
  }

  if (path.currentStep !== name) {
    // Entered and left behind: the onboarding got through this step.
    return 'completed';
  }

  // Where it stands now. A step it settled on says how it ended rather than that it is waiting:
  // an approved end is a completion, a rejected or invalid one is a failure.
  const tone = describeAdminOnboardingStatusTone(status);

  if (tone === 'failure') {
    return 'failed';
  }

  return tone === 'success' ? 'completed' : 'current';
}

/**
 * Places every declared step on a grid and routes an elbow between each declared transition,
 * marking what the onboarding actually walked.
 *
 * Boxes are a fixed size and positions are computed here rather than measured, so the same input
 * always draws the same picture and the SVG edges and the node boxes agree without the two having
 * to observe each other.
 */
export function layoutWorkflowGraph(
  definition: WorkflowDefinition,
  path: WorkflowPath,
): WorkflowGraph {
  const depths = measureDepths(definition);
  const rows = new Map<number, string[]>();

  for (const step of definition.steps) {
    const depth = depths.get(step.name) ?? 0;
    rows.set(depth, [...(rows.get(depth) ?? []), step.name]);
  }

  const widestRow = Math.max(...[...rows.values()].map((row) => row.length));
  const width = widestRow * NODE_WIDTH + (widestRow - 1) * COLUMN_GAP;
  const positions = new Map<string, { x: number; y: number }>();

  for (const [depth, row] of rows) {
    const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * COLUMN_GAP;
    const offset = (width - rowWidth) / 2;

    row.forEach((name, column) => {
      positions.set(name, {
        x: offset + column * (NODE_WIDTH + COLUMN_GAP),
        y: depth * (NODE_HEIGHT + ROW_GAP),
      });
    });
  }

  const nodes: WorkflowGraphNode[] = definition.steps.map((step) => {
    const position = positions.get(step.name) ?? { x: 0, y: 0 };

    return {
      name: step.name,
      status: step.status,
      terminal: step.terminal,
      state: toNodeState(step.name, step.status, path),
      enteredAt: path.enteredAt.get(step.name) ?? null,
      selfTransitions: step.transitions
        .filter((transition) => transition.target === null || transition.target === step.name)
        .map((transition) => transition.status),
      x: position.x,
      y: position.y,
    };
  });

  // Planned before any is routed, because where an edge lands depends on how many others land
  // on the same target, which is only known once every step's transitions have been collected.
  const planned: Array<{
    from: string;
    to: string;
    status: string;
    outgoingIndex: number;
  }> = [];

  for (const step of definition.steps) {
    if (!positions.has(step.name)) {
      continue;
    }

    // Only the transitions that reach another step are drawn; the rest are labels on the node.
    const outgoing = step.transitions.filter(
      (transition) =>
        transition.target !== null &&
        transition.target !== step.name &&
        positions.has(transition.target),
    );

    outgoing.forEach((transition, outgoingIndex) => {
      planned.push({
        from: step.name,
        to: transition.target as string,
        status: transition.status,
        outgoingIndex,
      });
    });
  }

  const centreX = (name: string): number => (positions.get(name)?.x ?? 0) + NODE_WIDTH / 2;

  const routed = planned.map((edge) => ({
    ...edge,
    row: depths.get(edge.from) ?? 0,
    startX: centreX(edge.from),
    startY: (positions.get(edge.from)?.y ?? 0) + NODE_HEIGHT,
    endX: centreX(edge.to),
    endY: positions.get(edge.to)?.y ?? 0,
    laneY: null as number | null,
  }));

  const LANE_CLEARANCE = 12;

  /**
   * Every edge out of a step leaves from one point under the middle of its box, so the ways out of
   * a step read as one trunk that divides rather than as several lines starting side by side. They
   * part company at their break points, which is where the choice actually happens.
   *
   * Arrivals are spread along the head of the target instead, ordered by where they come from, so
   * that arrowheads stay apart and the edges do not cross each other right at the box.
   */
  for (const name of positions.keys()) {
    const arriving = routed.filter((edge) => edge.to === name);

    if (arriving.length < 2) {
      continue;
    }

    const boxLeft = (positions.get(name)?.x ?? 0) as number;
    [...arriving]
      .sort((left, right) => left.startX - right.startX)
      .forEach((edge, index) => {
        edge.endX = boxLeft + (NODE_WIDTH * (index + 1)) / (arriving.length + 1);
      });
  }

  /**
   * Puts an arrival back under its trunk when the step it comes from sits directly above, so the
   * spine of a workflow stays one straight line instead of jogging around the arrowheads either
   * side of it. Skipped where that would land the head on top of another arriving edge.
   */
  for (const edge of routed) {
    const sameColumn = Math.abs(centreX(edge.to) - edge.startX) < 0.5;
    const wouldCollide = routed.some(
      (other) =>
        other !== edge &&
        other.to === edge.to &&
        Math.abs(other.endX - edge.startX) < LANE_CLEARANCE,
    );

    if (sameColumn && !wouldCollide) {
      edge.endX = edge.startX;
    }
  }

  const turns = (edge: (typeof routed)[number]): boolean => Math.abs(edge.endX - edge.startX) > 0.5;

  /**
   * Pushes an arriving edge off any vertical another edge already occupies.
   *
   * Two boxes in the same column hand out anchors at the same offsets, so an edge leaving the
   * upper box and an unrelated edge arriving at the lower one can sit on the same vertical. They
   * are then drawn as one line broken in the middle, and there is no telling which end belongs to
   * which. Only arriving anchors are moved, because sliding an arrowhead along the head of its own
   * box costs nothing, and only edges that turn are moved, so a straight run stays straight.
   */
  const INSET = 20;
  for (const row of new Set(routed.map((edge) => edge.row))) {
    const band = routed.filter((edge) => edge.row === row);
    // Trunks, plus the arrivals already settled: a straight run holds its vertical, and every
    // nudged arrival has to stay clear of the ones placed before it.
    const occupied = [
      ...band.map((edge) => edge.startX),
      ...band.filter((edge) => !turns(edge)).map((edge) => edge.endX),
    ];

    for (const edge of band.filter(turns)) {
      const box = positions.get(edge.to)!;
      const conflicts = (x: number): boolean =>
        occupied.some((taken) => Math.abs(taken - x) < LANE_CLEARANCE);

      for (let step = 0; conflicts(edge.endX) && step < 8; step += 1) {
        const candidate = edge.endX + (step % 2 === 0 ? 1 : -1) * LANE_CLEARANCE * (step + 1);

        if (candidate > box.x + INSET && candidate < box.x + NODE_WIDTH - INSET) {
          edge.endX = candidate;
        }
      }

      occupied.push(edge.endX);
    }
  }

  /**
   * Shares out the heights at which the edges leaving a row make their sideways turn.
   *
   * Two runs only need separate heights if they would otherwise lie on each other, so lanes are
   * packed: an edge takes the highest lane whose runs it does not overlap. Edges heading opposite
   * ways out of the same step therefore turn level with each other, which is what makes a fork
   * read as one shape rather than as a flight of steps.
   *
   * The shortest hop is placed first, so a long sideways run settles below the local ones it would
   * otherwise cut across. An edge running straight down needs no turn at all: it takes no lane.
   */
  for (const row of new Set(routed.map((edge) => edge.row))) {
    const turning = routed
      .filter((edge) => edge.row === row && turns(edge))
      .sort((left, right) => {
        const leftSpan = Math.abs(left.endX - left.startX);
        const rightSpan = Math.abs(right.endX - right.startX);

        return leftSpan === rightSpan ? left.startX - right.startX : leftSpan - rightSpan;
      });

    const lanes: Array<Array<[number, number]>> = [];
    const laneOfEdge = turning.map((edge) => {
      // Padded away from the target so two runs ending near each other still read apart, but not
      // away from the trunk: two branches leaving one step in opposite directions meet at that
      // point by definition, and that meeting is the fork itself, not a collision.
      const span: [number, number] =
        edge.endX > edge.startX
          ? [edge.startX, edge.endX + LANE_CLEARANCE]
          : [edge.endX - LANE_CLEARANCE, edge.startX];
      // Touching at a single point is allowed; only a real overlap needs another lane.
      const clear = (occupied: Array<[number, number]>): boolean =>
        occupied.every(([left, right]) => span[1] <= left || span[0] >= right);

      let lane = lanes.findIndex(clear);
      if (lane === -1) {
        lane = lanes.push([]) - 1;
      }

      lanes[lane].push(span);

      return lane;
    });

    turning.forEach((edge, index) => {
      edge.laneY = edge.startY + (ROW_GAP * (laneOfEdge[index] + 1)) / (lanes.length + 1);
    });
  }

  const stateByName = new Map(nodes.map((node) => [node.name, node.state]));

  const edges: WorkflowGraphEdge[] = routed.map((edge) => ({
    id: `${edge.from}-${edge.outgoingIndex}-${edge.to}`,
    from: edge.from,
    to: edge.to,
    tone:
      stateByName.get(edge.from) === 'completed'
        ? (stateByName.get(edge.to) ?? 'pending')
        : 'pending',
    points:
      edge.laneY === null
        ? [
            [edge.startX, edge.startY],
            [edge.endX, edge.endY],
          ]
        : [
            [edge.startX, edge.startY],
            [edge.startX, edge.laneY],
            [edge.endX, edge.laneY],
            [edge.endX, edge.endY],
          ],
  }));

  // Neutral arrows are painted first, so where two cross, the coloured one stays unbroken.
  edges.sort((left, right) => Number(left.tone !== 'pending') - Number(right.tone !== 'pending'));

  const depthCount = Math.max(...depths.values()) + 1;

  return {
    nodes,
    edges,
    width,
    height: depthCount * NODE_HEIGHT + (depthCount - 1) * ROW_GAP,
  };
}
