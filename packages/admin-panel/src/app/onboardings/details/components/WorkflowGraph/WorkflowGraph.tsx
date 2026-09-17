import { useEffect, useMemo, type ReactElement } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  type EdgeTypes,
  type FitViewOptions,
  type NodeTypes,
} from '@xyflow/react';
import { useWorkflowGraphStore } from '../../stores/workflow-graph-store';
import {
  findCurrentStep,
  type WorkflowGraph as WorkflowGraphModel,
  type WorkflowStepNode,
} from '../../utils/workflow-graph-layout';
import { WorkflowGraphEdge } from './WorkflowGraphEdge';
import { WorkflowGraphNode } from './WorkflowGraphNode';

export interface WorkflowGraphProps {
  graph: WorkflowGraphModel;
}

const NODE_TYPES: NodeTypes = { workflowStep: WorkflowGraphNode };
const EDGE_TYPES: EdgeTypes = { workflowTransition: WorkflowGraphEdge };

/**
 * Zoom the view opens at when it centres on one step. Fitting a single box would otherwise zoom
 * all the way to React Flow's own maximum and fill the canvas with it; at 1 the step is drawn at
 * its own size, with the steps around it still in view.
 */
const FOCUS_ZOOM = 1;

function WorkflowGraphCanvas({ graph }: WorkflowGraphProps): ReactElement {
  const nodes = useWorkflowGraphStore((state) => state.nodes);
  const edges = useWorkflowGraphStore((state) => state.edges);
  const onNodesChange = useWorkflowGraphStore((state) => state.onNodesChange);
  const onEdgesChange = useWorkflowGraphStore((state) => state.onEdgesChange);
  const setGraph = useWorkflowGraphStore((state) => state.setGraph);

  // Opens centred on the step the onboarding is waiting on. A workflow with more steps than the
  // canvas holds otherwise opens on the whole drawing zoomed out, or on its first step, leaving
  // the operator to pan around for where this onboarding actually stands. An onboarding that has
  // settled has no such step, and still opens on the whole graph.
  const fitViewOptions = useMemo((): FitViewOptions<WorkflowStepNode> | undefined => {
    const currentStep = findCurrentStep(graph);

    return currentStep === undefined
      ? undefined
      : { nodes: [{ id: currentStep.id }], maxZoom: FOCUS_ZOOM };
  }, [graph]);

  useEffect(() => {
    setGraph(graph.nodes, graph.edges);

    // The store outlives this component, so without this an onboarding opened right after another
    // would flash the previous one's graph for a frame before this effect replaces it.
    return () => setGraph([], []);
  }, [graph, setGraph]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      fitView
      fitViewOptions={fitViewOptions}
    />
  );
}

/**
 * Draws the whole workflow it declares - every step and every transition between them - with the
 * path this onboarding walked picked out against the paths it did not. Node positions come from
 * `layoutWorkflowGraph`'s dagre pass; this component only hands them to React Flow to draw, pan
 * and zoom.
 */
export function WorkflowGraph({ graph }: WorkflowGraphProps): ReactElement {
  return (
    <div className="workflow-canvas">
      <ReactFlowProvider>
        <WorkflowGraphCanvas graph={graph} />
      </ReactFlowProvider>
    </div>
  );
}
