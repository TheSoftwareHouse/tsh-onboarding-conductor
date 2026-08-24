import dagre from '@dagrejs/dagre';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { WorkflowDefinition } from '../types/workflow-definition';
import { describeAdminOnboardingStatusTone } from '../types/admin-onboarding';
import type { WorkflowPath } from './workflow-path';

/** Node box size, fixed so dagre ranks steps without measuring the DOM. */
export const NODE_WIDTH = 248;
export const NODE_HEIGHT = 88;

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
   * How the arrow is drawn: the state of the step it points at, so a line and its destination
   * read as one thing.
   *
   * Only an arrow leaving a step the onboarding completed carries that colour. One leaving a step
   * it never reached stays neutral however its destination is coloured, because colouring it
   * would claim a move that never happened.
   */
  tone: WorkflowNodeState;
};

export type WorkflowStepNode = Node<WorkflowNodeData, 'workflowStep'>;
export type WorkflowGraphEdge = Edge<WorkflowEdgeData>;

export interface WorkflowGraph {
  nodes: WorkflowStepNode[];
  edges: WorkflowGraphEdge[];
}

const EDGE_TONE_COLOR: Record<WorkflowNodeState, string> = {
  completed: 'var(--success-color)',
  current: 'var(--focus-color)',
  failed: 'var(--error-color)',
  pending: 'var(--border-strong-color)',
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
 * as a label instead. Retry loops are declared like any other transition - dagre breaks the cycle
 * they form internally when it ranks the steps, so there is nothing bespoke to do for them here.
 */
export function layoutWorkflowGraph(
  definition: WorkflowDefinition,
  path: WorkflowPath,
): WorkflowGraph {
  const declared = new Set(definition.steps.map((step) => step.name));
  const stateByName = new Map(
    definition.steps.map((step) => [step.name, toNodeState(step.name, step.status, path)]),
  );

  const transitions = definition.steps.flatMap((step) =>
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

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 88 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const step of definition.steps) {
    graph.setNode(step.name, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const transition of transitions) {
    graph.setEdge(transition.from, transition.to);
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

  const edges: WorkflowGraphEdge[] = transitions.map(({ id, from, to }) => {
    const tone =
      stateByName.get(from) === 'completed' ? (stateByName.get(to) ?? 'pending') : 'pending';
    const color = EDGE_TONE_COLOR[tone];

    return {
      id,
      source: from,
      target: to,
      type: 'smoothstep',
      animated: tone === 'current',
      // Coloured edges sit above the neutral ones they might cross, so a path this onboarding
      // walked stays unbroken rather than being cut by an unrelated line drawn after it.
      zIndex: tone === 'pending' ? 0 : 1,
      style: { stroke: color, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      data: { tone },
    };
  });

  return { nodes, edges };
}
