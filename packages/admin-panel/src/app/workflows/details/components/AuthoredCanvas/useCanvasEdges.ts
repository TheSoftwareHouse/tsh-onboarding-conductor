import { useMemo } from 'react';
import { MarkerType } from '@xyflow/react';
import type { ProjectedEdge } from '../../utils/authored-projection';
import type { EdgeRoute } from '../../utils/edge-routing';
import type { ConditionEdgeType } from './ConditionEdge';
import { HIGHLIGHT_MARKER_COLOR } from './canvas-constants';

interface EdgeOptions {
  edges: ProjectedEdge[];
  backEdges: Set<string>;
  routes: Map<string, EdgeRoute>;
  selectedStep: string | null;
  selectedEdge: string | null;
}

/** The drawn edges: back edges dashed, the selected step's edges highlighted. */
export function useCanvasEdges({
  edges,
  backEdges,
  routes,
  selectedStep,
  selectedEdge,
}: EdgeOptions): ConditionEdgeType[] {
  return useMemo(() => {
    // Labels hang under their port; arms of one port stack, so count them per port.
    const stacked = new Map<string, number>();
    return edges
      .filter((edge) => !edge.dangling)
      .map((edge): ConditionEdgeType => {
        const isBack = backEdges.has(edge.id);
        const highlighted =
          edge.id === selectedEdge ||
          (selectedStep !== null && (edge.source === selectedStep || edge.target === selectedStep));
        // A loop back keeps its condition on the port's tooltip, so its label does not cross the graph.
        const condition = isBack ? '' : edge.condition;
        const key = `${edge.source}:${edge.handle}`;
        const stackIndex = stacked.get(key) ?? 0;
        if (condition !== '') stacked.set(key, stackIndex + 1);
        return {
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.handle,
          target: edge.target,
          targetHandle: null,
          type: 'condition',
          selected: edge.id === selectedEdge,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            ...(highlighted ? { color: HIGHLIGHT_MARKER_COLOR } : {}),
          },
          // Drawn above the rest, so a highlighted edge is never hidden under another.
          zIndex: highlighted ? 1 : 0,
          data: {
            highlighted,
            isBack,
            port: edge.port,
            armIndex: edge.armIndex,
            condition,
            stackIndex,
            route: routes.get(edge.id) ?? null,
          },
        };
      });
  }, [edges, backEdges, routes, selectedStep, selectedEdge]);
}
