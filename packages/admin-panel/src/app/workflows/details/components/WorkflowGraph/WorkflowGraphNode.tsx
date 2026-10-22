import type { ReactElement } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { tv } from '@/lib/tv';
import { STEP_CATEGORY_TONES } from '../../constants/step-category-tones';
import { NODE_HEIGHT, NODE_WIDTH, type WorkflowStepNode } from '../../utils/workflow-graph-layout';

const HIDDEN_HANDLE = { opacity: 0, pointerEvents: 'none' } as const;

const APPROVED_STATUS = 'approved';

const node = tv({
  base: 'flex cursor-pointer flex-col justify-center gap-0.75 px-3 py-2.5 **:leading-natural',
  variants: {
    kind: {
      step: 'border border-tsh-black bg-tsh-white',
      terminal: 'border border-tsh-black bg-bg-alt',
      approved: 'border border-tsh-black bg-tsh-black',
    },
    // An inset outline sits over the 1px border, so selecting never moves the content.
    selected: { true: 'outline-2 -outline-offset-1 outline-tsh-black' },
  },
  compoundVariants: [
    { kind: 'step', selected: true, class: 'bg-bg-subtle' },
    { kind: 'approved', selected: true, class: 'outline-2 outline-offset-2 outline-tsh-black' },
  ],
});

/** A read-only custom node; React Flow's own wrapper already carries the accessible `group` role. */
export function WorkflowGraphNode({ data, selected }: NodeProps<WorkflowStepNode>): ReactElement {
  const approved = data.terminal && data.status === APPROVED_STATUS;
  const kind = approved ? 'approved' : data.terminal ? 'terminal' : 'step';

  return (
    <div
      className={cn(
        node({ kind, selected }),
        // A bar, not a fill, so the node keeps its text contrast; the approved terminal stays all black.
        !approved &&
          data.category !== null &&
          cn('border-l-8', STEP_CATEGORY_TONES[data.category]?.accent),
      )}
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} />
      <Typography
        variant="mono"
        title={data.name}
        className={cn(
          'truncate text-caps-tiny font-normal tracking-normal',
          approved ? 'text-tsh-white' : 'text-tsh-black',
        )}
      >
        {data.name}
      </Typography>
      <Typography
        variant="meta"
        className={cn('text-body-2xs', approved ? 'text-tsh-gray-300' : 'text-fg-4')}
      >
        {data.subtitle}
      </Typography>
      {data.transitionCount !== null && (
        <Typography variant="meta" className="text-body-2xs">
          {data.transitionCount} transitions
        </Typography>
      )}
      {data.selfTransitions.map((status) => (
        <Typography key={status} variant="meta" className="text-body-2xs">
          ↻ {status}
        </Typography>
      ))}
      <Handle type="source" position={Position.Bottom} style={HIDDEN_HANDLE} />
    </div>
  );
}
