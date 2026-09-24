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

/**
 * Holds the graph React Flow renders, following the state-management pattern from React Flow's
 * own docs: a store owning `nodes`/`edges` plus the change handlers React Flow calls back into,
 * rather than component state. Kept in this shape so it carries over unchanged once a workflow
 * visual editor needs to mutate this graph instead of only displaying it.
 */
export const useWorkflowGraphStore = create<WorkflowGraphState>((set, get) => ({
  nodes: [],
  edges: [],
  setGraph: (nodes, edges) => set({ nodes, edges }),
  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
}));
