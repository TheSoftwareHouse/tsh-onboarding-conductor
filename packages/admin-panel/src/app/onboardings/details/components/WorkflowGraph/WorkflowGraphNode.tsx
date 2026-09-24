import type { ReactElement } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format-date-time';
import { tv } from '@/lib/tv';
import { describeAdminOnboardingStatus } from '../../../types/admin-onboarding';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type WorkflowNodeData,
  type WorkflowNodeState,
  type WorkflowStepNode,
} from '../../utils/workflow-graph-layout';

const NODE_STATE_LABELS: Record<WorkflowNodeState, string> = {
  completed: 'Completed',
  current: 'Current step',
  failed: 'Failed',
  pending: 'Not taken',
};

const node = tv({
  base: 'flex flex-col justify-center gap-0.5 px-3.5 py-2.5',
  variants: {
    state: {
      // A step never reached stays plain and dashed however important it is to the workflow.
      pending: 'border border-dashed border-border-hair bg-bg-subtle',
      // Filled, as the design's completed path marker is - an outline would read as the current step.
      completed: 'border-2 border-tsh-black bg-tsh-black',
      current:
        'animate-node-pulse border-2 border-tsh-yellow-400 bg-tsh-yellow-400 motion-reduce:animate-none',
      failed: 'border-2 border-tsh-red bg-tsh-red/10',
    },
  },
});

/** Colour says how far this onboarding got with a step, not what the step itself declares. */
const NODE_TEXT_COLOR: Record<WorkflowNodeState, { name: string; meta: string }> = {
  pending: { name: 'text-fg-3', meta: 'text-fg-3' },
  completed: { name: 'text-tsh-white', meta: 'text-tsh-gray-300' },
  current: { name: 'text-fg-2', meta: 'text-fg-2' },
  failed: { name: 'text-fg-2', meta: 'text-fg-3' },
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
  const color = NODE_TEXT_COLOR[data.state];

  return (
    <div
      className={node({ state: data.state })}
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} />
      <Typography variant="body-md" className={cn('font-semibold wrap-anywhere', color.name)}>
        {data.name}
      </Typography>
      <Typography variant="meta" className={color.meta}>
        {describeAdminOnboardingStatus(data.status)}
      </Typography>
      <Typography variant="meta" className={color.meta}>
        {describeNodeState(data)}
      </Typography>
      {data.selfTransitions.map((status) => (
        <Typography key={status} variant="meta" className={color.meta}>
          ↻ {status}
        </Typography>
      ))}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
