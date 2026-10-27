import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectedEdge, ProjectedStep } from '../../utils/authored-projection';
import { layoutCanvas, type Positions } from '../../utils/canvas-layout';
import { placeNewSteps } from '../../utils/step-placement';

interface Projection {
  steps: ProjectedStep[];
  edges: ProjectedEdge[];
}

/** Lays out on open and on `relayout`, pins unseen steps where placed, and counts layouts in `layoutRun`. */
export function useCanvasPlacement(
  projection: Projection,
  backEdges: Set<string>,
): {
  placed: Positions | null;
  layoutRun: number;
  relayout: () => Positions;
  movePosition: (from: string, to: string) => void;
} {
  const [positions, setPositions] = useState<Positions | null>(null);
  const [layoutRun, setLayoutRun] = useState(0);

  const relayout = useCallback((): Positions => {
    const layout = layoutCanvas(projection.steps, projection.edges, backEdges);
    setPositions(layout);
    setLayoutRun((run) => run + 1);
    return layout;
  }, [projection, backEdges]);

  useEffect(() => {
    if (positions === null) relayout();
  }, [positions, relayout]);

  const placed = useMemo(
    () => (positions === null ? null : placeNewSteps(projection, positions)),
    [projection, positions],
  );

  useEffect(() => {
    if (placed !== null && positions !== null && placed.size > positions.size) setPositions(placed);
  }, [placed, positions]);

  /** A renamed step keeps its spot, which the layout knows by name. */
  const movePosition = useCallback((from: string, to: string) => {
    setPositions((current) => {
      const position = current?.get(from);
      if (!current || !position) return current;
      return new Map(current).set(to, position);
    });
  }, []);

  return { placed, layoutRun, relayout, movePosition };
}
