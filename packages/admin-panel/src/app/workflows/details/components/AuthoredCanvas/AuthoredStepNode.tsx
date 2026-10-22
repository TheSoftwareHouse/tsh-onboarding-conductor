// PoC (throwaway): one authored step, top to bottom: entry handle on top, one handle per port along the bottom.
import { useEffect, type ReactElement } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { STEP_CATEGORY_TONES } from '../../constants/step-category-tones';
import {
  describeCondition,
  GRID_SIZE,
  isBranched,
  toArmHandle,
  UNWIRED,
  type ProjectedStep,
} from './authored-graph';

export type AuthoredStepNodeData = ProjectedStep & {
  hasError: boolean;
  readOnly: boolean;
  /** A composable type is being dragged over this step: dropping it adds an included section. */
  isDropTarget: boolean;
};
export type AuthoredStepNode = Node<AuthoredStepNodeData, 'authoredStep'>;

const MIN_NODE_WIDTH = 200;
const PORT_CHAR_WIDTH = 6.5;
const PORT_PADDING = 20;
/** Whole grid cells, so a snapped node's bottom edge lands on the grid too: the header, the summary
 *  and the port labels. */
const BASE_NODE_HEIGHT = GRID_SIZE * 11;
/** One optional line — the included sections, or the first issue — in whole grid cells. */
const EXTRA_LINE_HEIGHT = GRID_SIZE * 2;
/** The node's `border` width; handles are positioned inside it. */
const NODE_BORDER_WIDTH = 1;

interface PortSlot {
  name: string;
  /** What the node prints under the handle; a custom step's transition shows its status. */
  label: string;
  detail?: string;
  optional: boolean;
  unwired: boolean;
  /** An arm or transition on this port lost its target. */
  unfinished: boolean;
  stray: boolean;
  width: number;
}

function listSlots(step: ProjectedStep): PortSlot[] {
  const known = step.ports.kind === 'known' ? step.ports.ports : [];
  return [
    ...known.flatMap((port) => {
      const label = port.label ?? port.name;
      const edge = step.step.edges?.[port.name];
      // A branched port splits into one handle per branch, numbered in the order they are tried.
      if (isBranched(edge)) {
        let order = 0;
        return edge.map((arm, armIndex) => {
          const guarded = arm.when !== undefined;
          if (guarded) order += 1;
          return {
            name: toArmHandle(port.name, armIndex),
            label: `${label}:${guarded ? order : 'else'}`,
            detail: guarded ? `if ${describeCondition(arm.when)}` : 'otherwise',
            optional: false,
            unwired: false,
            unfinished: arm.target === UNWIRED,
            stray: false,
          };
        });
      }
      return [
        {
          name: port.name,
          label,
          detail: port.detail,
          optional: port.optional === true,
          unwired: step.unwired.includes(port.name),
          unfinished: step.unfinished.includes(port.name),
          stray: false,
        },
      ];
    }),
    ...step.strayPorts.map((name) => ({
      name,
      label: name,
      optional: false,
      unwired: false,
      unfinished: false,
      stray: true,
    })),
  ].map((slot) => ({ ...slot, width: slot.label.length * PORT_CHAR_WIDTH + PORT_PADDING }));
}

/** Where each port's handle sits along the bottom edge, so the layout can place targets under their port. */
export function listPortCenters(step: ProjectedStep): { name: string; x: number }[] {
  const slots = listSlots(step);
  let offset = (nodeWidth(step) - slots.reduce((sum, slot) => sum + slot.width, 0)) / 2;
  return slots.map((slot) => {
    // On the grid, so a target laid out under this port stays under it once both nodes are snapped.
    const x = Math.round((offset + slot.width / 2) / GRID_SIZE) * GRID_SIZE;
    offset += slot.width;
    return { name: slot.name, x };
  });
}

/** Grows by a line for the included sections and one for an issue, so a plain step stays compact. */
export function nodeHeight(step: ProjectedStep & { hasError?: boolean }): number {
  const hasIncludes = (step.step.include ?? []).length > 0;
  const hasIssue = step.issues.length > 0 || step.hasError === true;
  return BASE_NODE_HEIGHT + EXTRA_LINE_HEIGHT * (Number(hasIncludes) + Number(hasIssue));
}

export function nodeWidth(step: ProjectedStep): number {
  const ports = listSlots(step).reduce((sum, slot) => sum + slot.width, 0);
  // Rounded up to two grid cells, so both the right edge and the centre (the entry handle) land on the grid.
  const cell = GRID_SIZE * 2;
  return Math.ceil(Math.max(MIN_NODE_WIDTH, ports) / cell) * cell;
}

export function AuthoredStepNodeView({
  id,
  data,
  selected,
}: NodeProps<AuthoredStepNode>): ReactElement {
  const { step, ports, isInitial, category, hasError, readOnly, summary } = data;
  const issues = hasError ? ['the last Validate failed here', ...data.issues] : data.issues;
  const slots = listSlots(data);
  // Branching a port adds handles; React Flow only learns of them when told, until then an edge
  // from a new handle cannot be drawn.
  const updateNodeInternals = useUpdateNodeInternals();
  const handleKey = slots.map((slot) => slot.name).join('\n');
  useEffect(() => updateNodeInternals(id), [id, handleKey, updateNodeInternals]);
  const includes = (step.include ?? []).map((include) => String(include.type));
  const width = nodeWidth(data);
  const centers = new Map(listPortCenters(data).map((center) => [center.name, center.x]));

  return (
    <div
      className={cn(
        'relative flex flex-col border bg-tsh-white',
        issues.length > 0 ? 'border-tsh-red' : 'border-tsh-black',
        selected && 'outline-2 outline-tsh-black',
        data.isDropTarget && 'outline-2 outline-offset-2 outline-tsh-blue-500 outline-dashed',
      )}
      style={{ width, height: nodeHeight(data) }}
    >
      <Handle type="target" position={Position.Top} className="size-2.5! bg-tsh-black!" />
      {/* An overlay, not a wider border, so the port handles keep their measured offsets. */}
      {category !== null && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-2',
            STEP_CATEGORY_TONES[category]?.bar,
          )}
        />
      )}
      <div className="flex flex-col gap-0.5 px-3 py-2">
        <div className="flex items-center gap-2">
          {isInitial && (
            <Typography variant="caps-tiny" as="span" className="bg-tsh-black px-1 text-tsh-white">
              start
            </Typography>
          )}
          {ports.kind === 'known' && ports.ports.length === 0 && (
            <Typography variant="caps-tiny" as="span" className="bg-tsh-black px-1 text-tsh-white">
              end
            </Typography>
          )}
          <Typography variant="mono" className="truncate text-caps-tiny" title={step.name}>
            {step.name}
          </Typography>
        </div>
        <Typography variant="meta" className="truncate">
          {step.type}
        </Typography>
      </div>
      <div className="flex flex-col gap-0.5 px-3 pt-1.5">
        <Typography variant="meta" className="truncate text-fg-2" title={summary}>
          {summary}
        </Typography>
        {includes.length > 0 && (
          <div className="flex gap-1 overflow-hidden" title={`Includes ${includes.join(', ')}`}>
            {includes.map((type, index) => (
              <Typography
                key={`${index}:${type}`}
                variant="meta"
                as="span"
                className="shrink-0 border border-border-strong px-1 text-fg-3"
              >
                + {type}
              </Typography>
            ))}
          </div>
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
        {slots.map((slot) => {
          const failing = slot.stray || slot.unfinished || (slot.unwired && !slot.optional);
          return (
            <Typography
              key={slot.name}
              variant="meta"
              as="span"
              title={
                slot.stray
                  ? 'Wired, but the type no longer has this port'
                  : slot.unfinished
                    ? `${slot.detail ?? 'A condition on this port'}: no target yet`
                    : failing
                      ? 'Required port with no target'
                      : slot.detail || (slot.optional ? 'Optional port' : undefined)
              }
              className={cn(
                'text-center',
                failing && 'text-tsh-red',
                slot.stray && 'line-through',
                slot.optional && slot.unwired && 'text-fg-disabled',
              )}
              style={{ width: slot.width }}
            >
              {slot.label}
            </Typography>
          );
        })}
      </div>
      {slots.map((slot) => {
        // `left` is measured from inside the border, while the centres are measured from its outside.
        const left = (centers.get(slot.name) ?? 0) - NODE_BORDER_WIDTH;
        const failing = slot.stray || slot.unfinished || (slot.unwired && !slot.optional);
        return (
          <Handle
            key={slot.name}
            id={slot.name}
            type="source"
            position={Position.Bottom}
            isConnectable={!readOnly}
            className={cn('size-2.5!', failing ? 'bg-tsh-red!' : 'bg-tsh-black!')}
            style={{ left }}
          />
        );
      })}
    </div>
  );
}
