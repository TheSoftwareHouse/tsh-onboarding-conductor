import { useEffect, type ReactElement } from 'react';
import { ReactFlow, ReactFlowProvider, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflowGraphStore } from '../stores/workflow-graph-store';
import type { WorkflowGraph as WorkflowGraphModel } from '../utils/workflow-graph-layout';
import { WorkflowGraphNode } from './WorkflowGraphNode';

export interface WorkflowGraphProps {
  graph: WorkflowGraphModel;
}

const NODE_TYPES: NodeTypes = { workflowStep: WorkflowGraphNode };

function WorkflowGraphCanvas({ graph }: WorkflowGraphProps): ReactElement {
  const nodes = useWorkflowGraphStore((state) => state.nodes);
  const edges = useWorkflowGraphStore((state) => state.edges);
  const onNodesChange = useWorkflowGraphStore((state) => state.onNodesChange);
  const onEdgesChange = useWorkflowGraphStore((state) => state.onEdgesChange);
  const setGraph = useWorkflowGraphStore((state) => state.setGraph);

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
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      fitView
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
