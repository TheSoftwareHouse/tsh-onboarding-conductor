import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProjectedEdge } from '../../utils/authored-projection';
import { HIGHLIGHT_MARKER_COLOR } from './canvas-constants';
import { useCanvasEdges } from './useCanvasEdges';

function edge(source: string, target: string): ProjectedEdge {
  return {
    id: `${source}:success:0`,
    source,
    target,
    handle: 'success',
    port: 'success',
    armIndex: 0,
    label: 'success',
    condition: '',
    dangling: false,
  };
}

const EDGES = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];
const BACK_EDGES = new Set(['c:success:0']);

function renderEdges(selectedStep: string | null) {
  return renderHook(() =>
    useCanvasEdges({
      edges: EDGES,
      backEdges: BACK_EDGES,
      routes: new Map(),
      selectedStep,
      selectedEdge: null,
    }),
  ).result.current;
}

describe('useCanvasEdges', () => {
  it('highlights the selected step’s edges, arrowheads included', () => {
    const [ab, bc] = renderEdges('a');

    expect(ab.data?.highlighted).toBe(true);
    expect(ab.markerEnd).toMatchObject({ color: HIGHLIGHT_MARKER_COLOR });
    expect(bc.data?.highlighted).toBe(false);
  });

  it('flags a back edge, and keeps the flag while it is highlighted', () => {
    const [, , ca] = renderEdges(null);
    const [, , highlighted] = renderEdges('c');

    expect(ca.data).toMatchObject({ isBack: true, highlighted: false });
    expect(highlighted.data).toMatchObject({ isBack: true, highlighted: true });
  });
});
