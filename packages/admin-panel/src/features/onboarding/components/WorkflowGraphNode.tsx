import type { ReactElement } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { describeAdminOnboardingStatus } from '../types/admin-onboarding';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type WorkflowNodeData,
  type WorkflowNodeState,
  type WorkflowStepNode,
} from '../utils/workflow-graph-layout';

const NODE_STATE_LABELS: Record<WorkflowNodeState, string> = {
  completed: 'Completed',
  current: 'Current step',
  failed: 'Failed',
  pending: 'Not taken',
  skipped: 'Skipped',
};

/**
 * Says how far this onboarding got with the step, and when. The word is carried as text rather
 * than by colour alone, so the graph still reads without it.
 */
function describeNodeState(data: WorkflowNodeData): string {
  const label = NODE_STATE_LABELS[data.state];

  return data.enteredAt === null ? label : `${label} · ${formatDateTime(data.enteredAt)}`;
}

/**
 * React Flow's custom node for one declared workflow step, coloured by this onboarding's
 * progress. React Flow already gives its node wrapper an accessible `group` role, so this content
 * carries none of its own - stacking a `listitem` on top would have nothing valid to nest it in,
 * since that wrapper sits inside React Flow's own `application`-rooted canvas rather than a list.
 */
export function WorkflowGraphNode({ data }: NodeProps<WorkflowStepNode>): ReactElement {
  return (
    <div
      className={`graph-node graph-node--${data.state}`}
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} />
      <p className="graph-node__name">{data.name}</p>
      <p className="graph-node__meta">{describeAdminOnboardingStatus(data.status)}</p>
      <p className="graph-node__meta">{describeNodeState(data)}</p>
      {data.selfTransitions.map((status) => (
        <p key={status} className="graph-node__meta">
          ↻ {status}
        </p>
      ))}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
