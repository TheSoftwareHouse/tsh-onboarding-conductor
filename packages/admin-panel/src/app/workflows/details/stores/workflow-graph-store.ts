import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { create } from 'zustand';
import type { WorkflowGraphEdge, WorkflowStepNode } from '../utils/workflow-graph-layout';

interface WorkflowGraphState {
  nodes: WorkflowStepNode[];
  edges: WorkflowGraphEdge[];
  setGraph: (nodes: WorkflowStepNode[], edges: WorkflowGraphEdge[]) => void;
  onNodesChange: (changes: NodeChange<WorkflowStepNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<WorkflowGraphEdge>[]) => void;
}

/** The graph React Flow renders, kept in React Flow's store pattern for a future editor. */
export const useWorkflowGraphStore = create<WorkflowGraphState>((set, get) => ({
  nodes: [],
  edges: [],
  setGraph: (nodes, edges) => set({ nodes, edges }),
  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
}));
