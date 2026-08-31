import type { ReactElement } from 'react';
import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { buildEdgePath } from '../utils/workflow-edge-path';
import type { WorkflowGraphEdge as WorkflowGraphEdgeModel } from '../utils/workflow-graph-layout';

/**
 * One transition, drawn along the polyline dagre routed it down rather than along a line invented
 * between its two endpoints. Doing it this way is what keeps an edge off the boxes it passes: a
 * retry loop climbing back up the drawing, or a transition skipping a rank, both cross other steps
 * unless the route that avoided them is the route that gets drawn.
 *
 * An edge standing in for a pair of steps joined both ways carries `markerStart` as well, so one
 * line with an arrowhead at each end replaces two lines between the same two boxes.
 */
export function WorkflowGraphEdge({
  markerStart,
  markerEnd,
  style,
  data,
}: EdgeProps<WorkflowGraphEdgeModel>): ReactElement {
  return (
    <BaseEdge
      path={buildEdgePath(data?.points ?? [])}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
    />
  );
}
