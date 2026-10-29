import type { ReactElement } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { tv } from '@/lib/tv';
import { EDGE_OFFSET, listRoutePoints, type EdgeRoute } from '../../utils/edge-routing';
import { buildEdgePath } from '../../utils/workflow-edge-path';

export type ConditionEdgeData = {
  port: string;
  armIndex: number | null;
  /** The condition this edge is taken on; empty for a plain port. */
  condition: string;
  /** Arms leaving the same port stack their labels, so each needs its own row. */
  stackIndex: number;
  /** Leaves or enters the selected step. */
  highlighted: boolean;
  /** A loop back to an earlier step. */
  isBack: boolean;
  route: EdgeRoute | null;
};
export type ConditionEdgeType = Edge<ConditionEdgeData, 'condition'>;

const edgeStroke = tv({
  base: 'stroke-[1.5]',
  variants: {
    isBack: { true: 'stroke-fg-4 stroke-[1.25] [stroke-dasharray:5_4]' },
    highlighted: { true: 'stroke-tsh-blue-500 stroke-2' },
  },
});

/** React Flow's own opt-outs, so clicking a label neither drags nor pans; not Tailwind classes. */
const REACT_FLOW_INTERACTIVE = 'nodrag nopan';
const LABEL_GAP = 10;
const LABEL_ROW_HEIGHT = 18;
const MAX_LABEL_CHARS = 32;

export function ConditionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<ConditionEdgeType>): ReactElement {
  const route = data?.route ?? null;
  const entryX = targetX + (route?.entryOffset ?? 0);
  const path =
    route !== null && (route.dropY !== null || route.turnY !== null)
      ? buildEdgePath(listRoutePoints({ x: sourceX, y: sourceY }, { x: entryX, y: targetY }, route))
      : getSmoothStepPath({
          sourceX,
          sourceY,
          targetX: entryX,
          targetY,
          sourcePosition,
          targetPosition,
          offset: EDGE_OFFSET,
        })[0];
  const condition = data?.condition ?? '';
  const short =
    condition.length > MAX_LABEL_CHARS ? `${condition.slice(0, MAX_LABEL_CHARS - 1)}…` : condition;
  const top = sourceY + LABEL_GAP + (data?.stackIndex ?? 0) * LABEL_ROW_HEIGHT;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={edgeStroke({ isBack: data?.isBack, highlighted: data?.highlighted })}
      />
      {short !== '' && (
        <EdgeLabelRenderer>
          <Typography
            variant="mono"
            as="div"
            title={condition}
            className={cn(
              REACT_FLOW_INTERACTIVE,
              'pointer-events-auto absolute border border-border-rule bg-bg-page px-1 text-body-2xs/4 whitespace-nowrap text-fg-2',
              data?.highlighted && 'z-10 border-tsh-blue-500 font-bold text-tsh-blue-500',
            )}
            // React Flow's computed position.
            style={{ transform: `translate(-50%, 0) translate(${sourceX}px, ${top}px)` }}
          >
            {short}
          </Typography>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
