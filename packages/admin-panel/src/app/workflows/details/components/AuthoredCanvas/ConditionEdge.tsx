// PoC (throwaway): an orthogonal edge along its route, its label just under the port it leaves.
// Mid-way labels of edges converging on one step land on the same shared segment and overlap.
import type { ReactElement } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { cn } from '@/lib/cn';
import { buildEdgePath, type EdgePoint } from '../../utils/workflow-edge-path';
import type { EdgeRoute } from './edge-routing';

export type ConditionEdgeData = {
  port: string;
  armIndex: number | null;
  /** The condition this edge is taken on; empty for a plain port. */
  condition: string;
  /** Arms leaving the same port stack their labels, so each needs its own row. */
  stackIndex: number;
  /** Leaves or enters the selected step. */
  highlighted: boolean;
  borderRadius: number;
  offset: number;
  route: EdgeRoute | null;
};
export type ConditionEdgeType = Edge<ConditionEdgeData, 'condition'>;

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
  style,
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
          borderRadius: data?.borderRadius,
          offset: data?.offset,
        })[0];
  const condition = data?.condition ?? '';
  const short =
    condition.length > MAX_LABEL_CHARS ? `${condition.slice(0, MAX_LABEL_CHARS - 1)}…` : condition;
  const top = sourceY + LABEL_GAP + (data?.stackIndex ?? 0) * LABEL_ROW_HEIGHT;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {short !== '' && (
        <EdgeLabelRenderer>
          <div
            title={condition}
            className={cn(
              REACT_FLOW_INTERACTIVE,
              'pointer-events-auto absolute border border-border-rule bg-tsh-white px-1 font-mono text-body-2xs/4  whitespace-nowrap text-fg-2',
              data?.highlighted && 'z-10 border-tsh-blue-500 font-bold text-tsh-blue-500',
            )}
            style={{ transform: `translate(-50%, 0) translate(${sourceX}px, ${top}px)` }}
          >
            {short}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** The corners an edge passes, as its route lays them out; see `EdgeRoute`. */
function listRoutePoints(source: EdgePoint, target: EdgePoint, route: EdgeRoute): EdgePoint[] {
  const points = [source];
  if (route.dropY !== null) points.push({ x: source.x, y: route.dropY });
  if (route.laneX !== null && route.turnY !== null) {
    points.push({ x: route.laneX, y: route.dropY ?? source.y }, { x: route.laneX, y: route.turnY });
  } else if (route.turnY !== null) {
    points.push({ x: source.x, y: route.turnY });
  }
  points.push({ x: target.x, y: points[points.length - 1]!.y }, target);
  return points.filter(
    (point, index) =>
      index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y,
  );
}
