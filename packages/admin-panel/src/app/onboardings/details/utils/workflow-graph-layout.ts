import dagre from '@dagrejs/dagre';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { WorkflowDefinition } from '@/api/workflows/workflow-definitions';
import { describeAdminOnboardingStatusTone } from '../../types/admin-onboarding';
import { walkedEdgeKey, type WorkflowPath } from './workflow-path';
import type { EdgePoint } from './workflow-edge-path';

/** Node box size, fixed so dagre ranks steps without measuring the DOM. */
export const NODE_WIDTH = 248;
export const NODE_HEIGHT = 88;

/** Room around the drawing for edges dagre routes outside the column of nodes. */
const GRAPH_MARGIN_X = 72;

/**
 * How far this onboarding got with a step, which is what the graph colours by. Deliberately about
 * the onboarding's progress rather than the step's declared status: the same step reads as
 * completed for one onboarding and as never taken for the next.
 */
export type WorkflowNodeState = 'completed' | 'current' | 'failed' | 'pending';

/**
 * Data a workflow step node carries, read by the `WorkflowGraphNode` component.
 *
 * Declared as a `type` rather than an `interface`: React Flow's `Node<TData>` constrains `TData`
 * to `Record<string, unknown>`, which only a type literal satisfies structurally.
 */
export type WorkflowNodeData = {
  name: string;
  status: string;
  state: WorkflowNodeState;
  /** When the onboarding entered this step, or null if it never did. */
  enteredAt: string | null;
  /** Transitions the step declares onto itself, which are labels rather than edges. */
  selfTransitions: string[];
};

/** Data a transition edge carries, alongside the `style`/`markerEnd` it renders with. */
export type WorkflowEdgeData = {
  /**
   * The route dagre laid the edge along, in the same coordinate space as the node positions.
   * `WorkflowGraphEdge` draws exactly this: dagre routes around every box the edge passes, and
   * inventing a line between the two endpoints instead is what put edges across the nodes.
   */
  points: EdgePoint[];
  /**
   * How the arrow is drawn: the state of the step it points at, so a line and its destination
   * read as one thing.
   *
   * Only an arrow for a transition the onboarding actually took carries that colour. Reaching
   * both of a transition's ends is not the same as using it — a step can be left by one of
   * several routes — so any other arrow stays neutral, because colouring it would claim a move
   * that never happened.
   */
  tone: WorkflowNodeState;
};

export type WorkflowStepNode = Node<WorkflowNodeData, 'workflowStep'>;
export type WorkflowGraphEdge = Edge<WorkflowEdgeData, 'workflowTransition'>;

export interface WorkflowGraph {
  nodes: WorkflowStepNode[];
  edges: WorkflowGraphEdge[];
}

// Points at the same tokens the node itself is filled with, so an edge and the step it leads to
// read as one thing.
const EDGE_TONE_COLOR: Record<WorkflowNodeState, string> = {
  completed: 'var(--color-tsh-black)',
  current: 'var(--color-tsh-yellow-400)',
  failed: 'var(--color-tsh-red)',
  pending: 'var(--color-border-strong)',
};

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
 * Places every declared step with dagre's layered layout and draws an edge for each declared
 * transition that leads to another declared step; a transition onto the step itself is left off
 * as a label instead.
 *
 * Both the node positions and the edge routes come from the same dagre pass. Taking the routes
 * too is what keeps a line off the boxes it passes: dagre inserts a dummy node on every rank an
 * edge crosses, so a retry loop climbing back up the drawing, and a transition skipping a rank,
 * are both bent around whatever sits between their ends. Drawing a line between the two endpoints
 * instead — which is what a plain `smoothstep` edge does — puts it straight through them.
 */
/** Both directions between one pair of steps, whichever way round they were declared. */
const pairKey = (edge: WorkflowGraphEdge): string =>
  [edge.source, edge.target].sort().join('\u0000');

/**
 * Collapses a step pair joined in both directions — `capture_selfie` leads to `submit_kyc`, and
 * `submit_kyc` retries back to it — into one line with an arrowhead at each end. Two separate
 * lines between the same two boxes read as clutter rather than as information, since the graph
 * says which steps connect, not in what order the transitions were declared.
 *
 * Runs after same-direction duplicates have been collapsed, so a pair holds at most one edge each
 * way and an exactly-one-each-way pair is the only thing there is to merge.
 */
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

    if (merged.has(pairKey(edge))) {
      continue;
    }
    merged.add(pairKey(edge));

    // Drawn along whichever route the onboarding actually walked, so the line keeps that colour
    // and that geometry; the other direction is carried by the second arrowhead alone.
    const walked = edge.data?.tone !== 'pending' ? edge : opposed;
    const other = walked === edge ? opposed : edge;
    const color = EDGE_TONE_COLOR[walked.data?.tone ?? 'pending'];

    result.push({
      ...walked,
      id: `${walked.id}+${other.id}`,
      markerStart: { type: MarkerType.ArrowClosed, color },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    });
  }

  return result;
}

export function layoutWorkflowGraph(
  definition: WorkflowDefinition,
  path: WorkflowPath,
): WorkflowGraph {
  const declared = new Set(definition.steps.map((step) => step.name));
  const stateByName = new Map(
    definition.steps.map((step) => [step.name, toNodeState(step.name, step.status, path)]),
  );

  const declaredTransitions = definition.steps.flatMap((step) =>
    step.transitions
      .filter(
        (transition) =>
          transition.target !== null &&
          transition.target !== step.name &&
          declared.has(transition.target),
      )
      .map((transition, index) => ({
        id: `${step.name}-${index}-${transition.target}`,
        from: step.name,
        to: transition.target as string,
      })),
  );

  // One line per ordered pair of steps, however many transitions declare it. A step routinely
  // reaches the same target more than one way — `manual_review` rejects on two different operator
  // actions, `submit_kyc` reaches review on both a score gate and a `human_review` verdict — and
  // drawing one line each produces arrows that are not merely cluttered but identical: an edge
  // takes its colour and its animation from the pair it joins, never from the transition that
  // declared it, so the duplicates cannot be told apart. The graph says which steps connect, not
  // how many ways there are between them; the routes themselves are read from the audit trail.
  //
  // Deduplicated before layout rather than after, so dagre never reserves the space for a line
  // that is not drawn.
  const transitions = declaredTransitions.filter(
    (transition, index) =>
      declaredTransitions.findIndex(
        (candidate) => candidate.from === transition.from && candidate.to === transition.to,
      ) === index,
  );

  // Multigraph, so the two directions between one pair of steps stay distinct edges rather than
  // one overwriting the other.
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 110, marginx: GRAPH_MARGIN_X });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const step of definition.steps) {
    graph.setNode(step.name, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const transition of transitions) {
    // Named, so a pair of steps joined by two transitions is two dagre edges rather than one
    // edge's worth of space with two lines drawn into it.
    graph.setEdge(transition.from, transition.to, {}, transition.id);
  }
  dagre.layout(graph);

  const nodes: WorkflowStepNode[] = definition.steps.map((step) => {
    const { x, y } = graph.node(step.name);

    return {
      id: step.name,
      type: 'workflowStep',
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      draggable: false,
      connectable: false,
      data: {
        name: step.name,
        status: step.status,
        state: stateByName.get(step.name) ?? 'pending',
        enteredAt: path.enteredAt.get(step.name) ?? null,
        selfTransitions: step.transitions
          .filter((transition) => transition.target === null || transition.target === step.name)
          .map((transition) => transition.status),
      },
    };
  });

  // Shifted so the drawing starts at (0, 0) regardless of where dagre chose to place it, which
  // keeps the same input always laying out to the same coordinates.
  const minX = nodes.length === 0 ? 0 : Math.min(...nodes.map((node) => node.position.x));
  const minY = nodes.length === 0 ? 0 : Math.min(...nodes.map((node) => node.position.y));
  for (const node of nodes) {
    node.position.x -= minX;
    node.position.y -= minY;
  }

  const drawn: WorkflowGraphEdge[] = transitions.map(({ id, from, to }) => {
    const tone = path.walkedEdges.has(walkedEdgeKey(from, to))
      ? (stateByName.get(to) ?? 'pending')
      : 'pending';
    const color = EDGE_TONE_COLOR[tone];
    // Shifted by the same offset as the nodes, so points and boxes stay in one coordinate space.
    const points = (graph.edge({ v: from, w: to, name: id })?.points ?? []).map(
      (point: EdgePoint) => ({ x: point.x - minX, y: point.y - minY }),
    );

    return {
      id,
      source: from,
      target: to,
      type: 'workflowTransition',
      animated: tone === 'current',
      style: { stroke: color, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      data: { tone, points },
    };
  });

  const edges = mergeOpposedEdges(drawn);

  // Drawn in array order, so a path this onboarding walked is painted after — and therefore over
  // — the neutral lines it crosses. Ordering rather than `zIndex`: a non-zero `zIndex` lifts an
  // edge above the node layer too, which is what drew coloured lines across the boxes.
  edges.sort((left, right) => {
    const leftWalked = left.data?.tone !== undefined && left.data.tone !== 'pending';
    const rightWalked = right.data?.tone !== undefined && right.data.tone !== 'pending';

    return Number(leftWalked) - Number(rightWalked);
  });

  return { nodes, edges };
}

/**
 * The step this onboarding is waiting on, or undefined once it has settled on a terminal one.
 * An onboarding stands on exactly one step, so at most one node carries the `current` state.
 */
export function findCurrentStep(graph: WorkflowGraph): WorkflowStepNode | undefined {
  return graph.nodes.find((node) => node.data.state === 'current');
}
