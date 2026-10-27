import { useEffect, type ReactElement } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { Chip } from '@/components/ui/Chip/Chip';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { tv } from '@/lib/tv';
import { STEP_CATEGORY_TONES } from '../../../constants/step-category-tones';
import { listScoringRules } from '../../../utils/authored-document';
import { type ProjectedStep } from '../../../utils/authored-projection';
import {
  listPortCenters,
  listSlots,
  nodeHeight,
  nodeWidth,
  type PortSlot,
} from '../../../utils/step-node-geometry';

export type AuthoredStepNodeData = ProjectedStep & {
  /** The last Validate failed inside this step. */
  hasError: boolean;
  readOnly: boolean;
  /** A composable type is being dragged over this step: dropping it adds an included section. */
  isDropTarget: boolean;
};
export type AuthoredStepNodeType = Node<AuthoredStepNodeData, 'authoredStep'>;

/** The node's `border` width; handles are positioned inside it. */
const NODE_BORDER_WIDTH = 1;

const node = tv({
  base: 'relative flex flex-col border bg-bg-page',
  variants: {
    problem: { true: 'border-tsh-red', false: 'border-tsh-black' },
    selected: { true: 'outline-2 outline-tsh-black' },
    dropTarget: { true: 'outline-2 outline-offset-2 outline-tsh-blue-500 outline-dashed' },
  },
});

const handle = tv({
  base: 'size-2.5!',
  variants: { failing: { true: 'bg-tsh-red!', false: 'bg-tsh-black!' } },
});

function isFailing(slot: PortSlot): boolean {
  return slot.stray || slot.unfinished || (slot.unwired && !slot.optional);
}

function describeSlot(slot: PortSlot): string | undefined {
  if (slot.stray) return 'Wired, but the type no longer has this port';
  if (slot.unfinished) return `${slot.detail ?? 'A condition on this port'}: no target yet`;
  if (isFailing(slot)) return 'Required port with no target';
  return slot.detail || (slot.optional ? 'Optional port' : undefined);
}

export function AuthoredStepNode({
  id,
  data,
  selected,
}: NodeProps<AuthoredStepNodeType>): ReactElement {
  const { step, ports, isInitial, category, hasError, readOnly, summary, isDropTarget } = data;
  const issues = hasError ? ['the last Validate failed here', ...data.issues] : data.issues;
  const slots = listSlots(data);
  // Branching a port adds handles; React Flow only learns of them when told.
  const updateNodeInternals = useUpdateNodeInternals();
  const handleKey = slots.map((slot) => slot.name).join('\n');
  useEffect(() => updateNodeInternals(id), [id, handleKey, updateNodeInternals]);
  const includes = (step.include ?? []).map((include) => String(include.type));
  const scores = [...new Set(listScoringRules(step).map((rule) => rule.score))];
  const centers = new Map(listPortCenters(data).map((center) => [center.name, center.x]));

  return (
    <div
      className={node({ problem: issues.length > 0, selected, dropTarget: isDropTarget })}
      style={{ width: nodeWidth(data), height: nodeHeight(data) }}
    >
      <Handle type="target" position={Position.Top} className="size-2.5! bg-tsh-black!" />
      {/* An overlay, not a wider border, so the port handles keep their measured offsets. */}
      {category !== null && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-2',
            STEP_CATEGORY_TONES[category].bar,
          )}
        />
      )}
      <div className="flex flex-col gap-0.5 px-3 py-2">
        <div className="flex items-center gap-2">
          {isInitial && (
            <Chip tone="strong" size="status" className="px-1 py-0">
              start
            </Chip>
          )}
          {ports.kind === 'known' && ports.ports.length === 0 && (
            <Chip tone="strong" size="status" className="px-1 py-0">
              end
            </Chip>
          )}
          <Typography variant="mono" className="truncate text-caps-tiny" title={step.name}>
            {step.name}
          </Typography>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Typography variant="meta" className="truncate">
            {step.type}
          </Typography>
          {category !== null && (
            <Chip tone="neutral" size="status" className="shrink-0 px-1 py-0">
              {category}
            </Chip>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 px-3 pt-1.5">
        <Typography variant="meta" className="truncate text-fg-2" title={summary}>
          {summary}
        </Typography>
        {includes.length > 0 && (
          <div className="flex gap-1 overflow-hidden" title={`Includes ${includes.join(', ')}`}>
            {includes.map((type, index) => (
              <Chip
                key={`${index}:${type}`}
                tone="outline"
                size="status"
                className="shrink-0 px-1 py-0"
              >
                + {type}
              </Chip>
            ))}
          </div>
        )}
        {scores.length > 0 && (
          <Typography variant="meta" className="truncate" title={`Scores ${scores.join(', ')}`}>
            scores: {scores.join(', ')}
          </Typography>
        )}
        {issues.length > 0 && (
          <Typography variant="meta" className="truncate text-tsh-red" title={issues.join('\n')}>
            ⚠ {issues[0]}
            {issues.length > 1 ? ` (+${issues.length - 1})` : ''}
          </Typography>
        )}
      </div>
      <div className="flex flex-1 items-end justify-center pb-1.5">
        {ports.kind === 'unknown-type' && (
          <Typography variant="meta" className="text-tsh-red">
            unknown type
          </Typography>
        )}
        {ports.kind === 'config-error' && (
          <Typography variant="meta" className="text-tsh-red" title={ports.message}>
            config invalid — ports unknown
          </Typography>
        )}
        {slots.map((slot) => (
          <Typography
            key={slot.name}
            variant="meta"
            as="span"
            title={describeSlot(slot)}
            className={cn(
              'text-center',
              isFailing(slot) && 'text-tsh-red',
              slot.stray && 'line-through',
              slot.optional && slot.unwired && 'text-fg-disabled',
            )}
            style={{ width: slot.width }}
          >
            {slot.label}
          </Typography>
        ))}
      </div>
      {slots.map((slot) => (
        <Handle
          key={slot.name}
          id={slot.name}
          type="source"
          position={Position.Bottom}
          isConnectable={!readOnly}
          className={handle({ failing: isFailing(slot) })}
          // `left` is measured from inside the border, while the centres are measured from its outside.
          style={{ left: (centers.get(slot.name) ?? 0) - NODE_BORDER_WIDTH }}
        />
      ))}
    </div>
  );
}
