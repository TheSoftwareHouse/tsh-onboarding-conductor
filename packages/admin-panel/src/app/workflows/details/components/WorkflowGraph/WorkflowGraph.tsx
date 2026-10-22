import { useCallback, useLayoutEffect, useMemo, useRef, type ReactElement } from 'react';
import {
  Panel,
  ReactFlow,
  useReactFlow,
  useStore,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react';
import type { WorkflowDefinition } from '@/api/workflows/workflow-definitions';
import { useWorkflowGraphStore } from '../../stores/workflow-graph-store';
import {
  ARROW_MARKER_ID,
  DASHED_ARROW_MARKER_ID,
  layoutWorkflowGraph,
  NODE_WIDTH,
} from '../../utils/workflow-graph-layout';
import { WorkflowGraphEdge } from './WorkflowGraphEdge';
import { WorkflowGraphNode } from './WorkflowGraphNode';
import { WorkflowGroupNode } from './WorkflowGroupNode';
import { WorkflowZoomControls } from './WorkflowZoomControls';
import type {
  WorkflowGroupNode as WorkflowGroupNodeType,
  WorkflowStepNode,
} from '../../utils/workflow-graph-layout';

export interface WorkflowGraphProps {
  definition: WorkflowDefinition;
  selectedStep: string;
  onSelectStep: (name: string) => void;
}

const NODE_TYPES: NodeTypes = { workflowStep: WorkflowGraphNode, workflowGroup: WorkflowGroupNode };
const EDGE_TYPES: EdgeTypes = { workflowTransition: WorkflowGraphEdge };

/** Gap between the canvas's top edge and the initial step on open. */
const INITIAL_STEP_INSET = 32;

/** Sub-pixel drift below this is our own opening view, not the operator moving the canvas. */
const MOVE_TOLERANCE = 0.5;

/** Draws a definition read-only; selection is controlled and needs a `ReactFlowProvider` above. */
export function WorkflowGraph({
  definition,
  selectedStep,
  onSelectStep,
}: WorkflowGraphProps): ReactElement {
  const storeNodes = useWorkflowGraphStore((state) => state.nodes);
  const edges = useWorkflowGraphStore((state) => state.edges);
  const onNodesChange = useWorkflowGraphStore((state) => state.onNodesChange);
  const onEdgesChange = useWorkflowGraphStore((state) => state.onEdgesChange);
  const setGraph = useWorkflowGraphStore((state) => state.setGraph);

  const graph = useMemo(() => layoutWorkflowGraph(definition), [definition]);

  // Layout effects, so a cached version switch paints the new graph already in place.
  useLayoutEffect(() => {
    setGraph(graph.nodes, graph.edges);

    // The store outlives this component, so a definition opened next would flash this one first.
    return () => setGraph([], []);
  }, [graph, setGraph]);

  // Group frames first, so they paint under the steps they enclose.
  const nodes = useMemo(
    () => [
      ...graph.groups,
      ...storeNodes.map((node) => ({ ...node, selected: node.id === selectedStep })),
    ],
    [graph.groups, storeNodes, selectedStep],
  );

  const { setViewport } = useReactFlow();
  const canvasWidth = useStore((state) => state.width);
  // The last opening view applied; null once the operator has moved, zoomed or selected.
  const opening = useRef<Viewport | null>(null);
  const interacted = useRef(false);

  useLayoutEffect(() => {
    interacted.current = false;
  }, [graph]);

  // Opens at 100% with the initial step centred near the top, re-applied as the canvas settles.
  const openAtInitialStep = useCallback((): void => {
    const initial = graph.nodes.find((node) => node.id === definition.initialStep);
    if (interacted.current || initial === undefined || canvasWidth === 0) return;
    const next = {
      x: canvasWidth / 2 - (initial.position.x + NODE_WIDTH / 2),
      y: INITIAL_STEP_INSET - initial.position.y,
      zoom: 1,
    };
    opening.current = next;
    void setViewport(next);
  }, [graph, definition.initialStep, canvasWidth, setViewport]);

  useLayoutEffect(openAtInitialStep, [openAtInitialStep]);

  const handleMove = useCallback((_: unknown, viewport: Viewport): void => {
    const last = opening.current;
    const moved =
      last === null ||
      Math.abs(viewport.x - last.x) > MOVE_TOLERANCE ||
      Math.abs(viewport.y - last.y) > MOVE_TOLERANCE ||
      viewport.zoom !== last.zoom;
    if (moved) interacted.current = true;
  }, []);

  const handleNodesChange = useCallback(
    (changes: NodeChange<WorkflowStepNode | WorkflowGroupNodeType>[]) => {
      for (const change of changes) {
        if (change.type === 'select' && change.selected && change.id !== selectedStep) {
          interacted.current = true;
          onSelectStep(change.id);
        }
      }
      // Group frames live in the layout, not the store, so their measurements are dropped here.
      const groupIds = new Set(graph.groups.map((group) => group.id));
      onNodesChange(
        changes.filter(
          (change) => change.type !== 'select' && !('id' in change && groupIds.has(change.id)),
        ) as NodeChange<WorkflowStepNode>[],
      );
    },
    [selectedStep, onSelectStep, onNodesChange, graph.groups],
  );

  return (
    // React Flow has no natural height, so this box and its `.react-flow` root both need one.
    <div className="min-h-0 w-full flex-auto [&_.react-flow]:size-full [&_.react-flow__handle]:invisible">
      <svg aria-hidden="true" className="absolute size-0">
        <defs>
          <marker
            id={ARROW_MARKER_ID}
            markerWidth="9"
            markerHeight="9"
            refX="8"
            refY="4.5"
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L9,4.5 L0,9 z" className="fill-fg-2" />
          </marker>
          <marker
            id={DASHED_ARROW_MARKER_ID}
            markerWidth="9"
            markerHeight="9"
            refX="8"
            refY="4.5"
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L9,4.5 L0,9 z" className="fill-fg-4" />
          </marker>
        </defs>
      </svg>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onInit={openAtInitialStep}
        onMove={handleMove}
        minZoom={0.1}
      >
        <Panel position="top-right">
          <WorkflowZoomControls />
        </Panel>
      </ReactFlow>
    </div>
  );
}
