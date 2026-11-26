import { describe, expect, it } from 'vitest';
import type { AuthoredDocument } from './authored-document';
import { listBackEdges, projectDocument } from './authored-projection';
import { layoutCanvas, RANK_GAP } from './canvas-layout';
import { EDGE_OFFSET, routeEdges, routeLines } from './edge-routing';
import { nodeHeight, nodeWidth, type GeometryNode } from './step-node-geometry';

const decision = (name: string, edges: Record<string, string>) => ({
  name,
  type: 'decision',
  config: { branches: [{ port: 'yes', when: { field: 'x', isSet: true } }], fallback: true },
  edges,
});

// Two blockers and a target: which of them sit in the way decides each edge's shape.
const DOC: AuthoredDocument = {
  initial: 'a',
  steps: [
    decision('a', { yes: 'target', default: 'near' }),
    decision('near', { yes: 'target', default: 'target' }),
    decision('blocker', { yes: 'target', default: 'target' }),
    decision('target', { yes: 'a', default: 'a' }),
  ],
};

const FAR_X = 1200;
const ROW_GAP = 300;

function place(positions: Record<string, { x: number; y: number }>, doc = DOC) {
  const { steps, edges } = projectDocument(doc);
  const nodes: GeometryNode[] = steps.map((step) => ({
    id: step.step.name,
    position: positions[step.step.name]!,
    data: { ...step, hasError: false },
  }));
  return { nodes, edges, back: listBackEdges(steps, edges) };
}

function find(
  edges: { id: string; source: string; target: string; port: string }[],
  source: string,
  target: string,
) {
  return edges.find((edge) => edge.source === source && edge.target === target)!;
}

describe('routeEdges shapes', () => {
  it('drops straight under the port and turns above the target when the way is clear (direct)', () => {
    const { nodes, edges, back } = place({
      a: { x: 0, y: 0 },
      near: { x: 0, y: ROW_GAP },
      blocker: { x: FAR_X * 2, y: ROW_GAP * 4 },
      target: { x: 0, y: ROW_GAP * 2 },
    });
    const route = routeEdges(nodes, edges, back).get(find(edges, 'a', 'near').id)!;

    expect(route.dropY).toBeNull();
    expect(route.laneX).toBeNull();
    expect(route.turnY).not.toBeNull();
  });

  it('runs across below the source and down onto the target when only its port is blocked (early)', () => {
    const a = { x: 0, y: 0 };
    const { nodes, edges, back } = place({
      a,
      near: { x: -nodeWidth(placeData('a')), y: ROW_GAP },
      blocker: { x: 0, y: ROW_GAP },
      target: { x: FAR_X, y: ROW_GAP * 2 },
    });
    const route = routeEdges(nodes, edges, back).get(find(edges, 'a', 'target').id)!;

    expect(route.laneX).toBeNull();
    expect(route.turnY).toBeNull();
    expect(route.dropY).not.toBeNull();
  });

  it('goes out along a lane when both the port and the target’s centre are blocked (lane)', () => {
    const { nodes, edges, back } = place({
      a: { x: 0, y: 0 },
      near: { x: -FAR_X, y: ROW_GAP * 4 },
      blocker: { x: 0, y: ROW_GAP },
      target: { x: FAR_X, y: ROW_GAP * 2 },
    });
    const blockers = nodes.map((node) =>
      node.id === 'near' ? { ...node, position: { x: FAR_X, y: ROW_GAP } } : node,
    );
    const route = routeEdges(blockers, edges, back).get(find(edges, 'a', 'target').id)!;

    expect(route.laneX).not.toBeNull();
    expect(route.dropY).not.toBeNull();
    expect(route.turnY).not.toBeNull();
  });

  it('draws a plain step line when the rows are too close to turn between (step)', () => {
    const { nodes, edges, back } = place({
      a: { x: 0, y: 0 },
      near: { x: 0, y: nodeHeight(placeData('a')) + EDGE_OFFSET },
      blocker: { x: FAR_X * 2, y: ROW_GAP * 4 },
      target: { x: FAR_X * 3, y: ROW_GAP * 4 },
    });
    const route = routeEdges(nodes, edges, back).get(find(edges, 'a', 'near').id)!;

    expect(route).toMatchObject({ dropY: null, laneX: null, turnY: null });
  });
});

function placeData(name: string) {
  return projectDocument(DOC).steps.find((step) => step.step.name === name)!;
}

describe('routeEdges heights and loops', () => {
  const laid = () => {
    const { steps, edges } = projectDocument(DOC);
    const back = listBackEdges(steps, edges);
    const positions = layoutCanvas(steps, edges, back);
    const nodes: GeometryNode[] = steps.map((step) => ({
      id: step.step.name,
      position: positions.get(step.step.name)!,
      data: { ...step, hasError: false },
    }));
    return { nodes, edges, back };
  };

  it('gives runs that share a gap distinct heights inside it', () => {
    const { nodes, edges, back } = place({
      a: { x: 0, y: 0 },
      near: { x: 0, y: ROW_GAP },
      blocker: { x: FAR_X, y: ROW_GAP },
      target: { x: FAR_X * 2, y: ROW_GAP },
    });
    const routes = routeEdges(nodes, edges, back);
    const turns = edges
      .filter((edge) => edge.source === 'a')
      .map((edge) => routes.get(edge.id)!.turnY ?? routes.get(edge.id)!.dropY);

    expect(turns.every((turn) => turn !== null)).toBe(true);
    expect(new Set(turns).size).toBe(turns.length);
    for (const turn of turns) {
      expect(turn!).toBeGreaterThanOrEqual(ROW_GAP - RANK_GAP + EDGE_OFFSET);
      expect(turn!).toBeLessThanOrEqual(ROW_GAP - EDGE_OFFSET);
    }
  });

  it('runs every retry loop on a lane to the right of the steps it passes', () => {
    const { nodes, edges, back } = laid();
    const routes = routeEdges(nodes, edges, back);
    const rightmost = Math.max(...nodes.map((node) => node.position.x + nodeWidth(node.data)));
    const loops = edges.filter((edge) => back.has(edge.id));

    expect(loops.length).toBeGreaterThan(0);
    for (const loop of loops) {
      expect(routes.get(loop.id)!.laneX).toBeGreaterThan(rightmost);
    }
  });
});

describe('routeLines', () => {
  const box = (id: string, x: number, y: number) => ({
    id,
    position: { x, y },
    width: 100,
    height: 60,
  });

  it('turns in the gap each row says it has under it', () => {
    const gap = 140;
    const nodes = [box('a', 0, 0), box('b', 200, 60 + gap)];
    const route = routeLines(
      nodes,
      [{ id: 'a>b', source: 'a', target: 'b', portX: 50 }],
      new Set(),
      { gapBelow: () => gap, gapAbove: () => gap },
    ).get('a>b')!;

    expect(route.turnY).toBeGreaterThanOrEqual(60 + EDGE_OFFSET);
    expect(route.turnY).toBeLessThanOrEqual(60 + gap - EDGE_OFFSET);
  });

  it('brings an early turn down between the lines it would otherwise cross', () => {
    // `left` runs straight down into `target`; `right` must turn early round `middle`, whose own
    // edge then turns in from the right.
    const nodes = [
      box('left', 0, 0),
      box('right', 300, 0),
      box('middle', 300, 200),
      box('target', 0, 400),
    ];
    const routes = routeLines(
      nodes,
      [
        { id: 'left', source: 'left', target: 'target', portX: 40 },
        { id: 'right', source: 'right', target: 'target', portX: 350 },
        { id: 'middle', source: 'middle', target: 'target', portX: 330 },
      ],
      new Set(),
    );
    const entryOf = (id: string) => routes.get(id)!.entryOffset;

    expect(routes.get('right')!.dropY).not.toBeNull();
    expect(entryOf('left')).toBeLessThan(entryOf('right'));
    expect(entryOf('right')).toBeLessThan(entryOf('middle'));
  });
});
