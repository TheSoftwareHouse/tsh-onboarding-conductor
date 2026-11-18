import { describe, expect, it } from 'vitest';
import type { AuthoredDocument } from './authored-document';
import { listBackEdges, projectDocument } from './authored-projection';
import { nodeHeight, nodeWidth, type GeometryNode } from './step-node-geometry';
import { layoutCanvas } from './canvas-layout';
import { routeEdges } from './edge-routing';

// `start` branches to `short` (a plain decision that loops back twice) and `tall` (a form with an
// included section and an unwired port, so it carries both optional lines): one rank, two heights.
const DOC: AuthoredDocument = {
  initial: 'start',
  steps: [
    {
      name: 'start',
      type: 'decision',
      config: { branches: [{ port: 'yes', when: { field: 'x', isSet: true } }], fallback: true },
      edges: { yes: 'short', default: 'tall' },
    },
    {
      name: 'short',
      type: 'decision',
      config: { branches: [{ port: 'again', when: { field: 'y', isSet: true } }], fallback: true },
      edges: { again: 'start', default: 'start' },
    },
    {
      name: 'tall',
      type: 'form',
      config: { fields: { tall_value: { type: 'text', required: true } } },
      include: [
        { type: 'consents', config: { consents: [{ key: 'terms', acknowledgement: 'accepted' }] } },
      ],
    },
  ],
};

function layOut() {
  const { steps, edges } = projectDocument(DOC);
  const back = listBackEdges(steps, edges);
  const positions = layoutCanvas(steps, edges, back);
  const nodes: GeometryNode[] = steps.map((step) => ({
    id: step.step.name,
    position: positions.get(step.step.name)!,
    data: { ...step, hasError: false },
  }));
  return { steps, edges, back, nodes };
}

describe('content-sized steps', () => {
  it('sizes a step by the optional lines it shows', () => {
    const { steps } = layOut();
    const height = (name: string): number =>
      nodeHeight(steps.find((step) => step.step.name === name)!);

    expect(height('tall')).toBeGreaterThan(height('short'));
  });

  it('top-aligns a rank whose steps differ in height', () => {
    const { nodes } = layOut();
    const y = (name: string): number => nodes.find((node) => node.id === name)!.position.y;

    expect(y('short')).toBe(y('tall'));
  });

  it('runs a short step’s edges in the gap below its rank’s tallest step, each at its own height', () => {
    const { nodes, edges, back } = layOut();
    const tall = nodes.find((node) => node.id === 'tall')!;
    const routes = routeEdges(nodes, edges, back);
    const drops = edges
      .filter((edge) => edge.source === 'short')
      .map((edge) => routes.get(edge.id)?.dropY ?? null);

    expect(drops).toHaveLength(2);
    for (const drop of drops) {
      expect(drop).not.toBeNull();
      expect(drop!).toBeGreaterThan(tall.position.y + nodeHeight(tall.data));
    }
    expect(new Set(drops).size).toBe(2);
  });

  it('runs a retry loop in the gap beside its steps, not past a step further out in its rows', () => {
    const { nodes, edges, back } = layOut();
    const short = nodes.find((node) => node.id === 'short')!;
    const rightmost = Math.max(...nodes.map((node) => node.position.x + nodeWidth(node.data)));
    // A step parked far to the right, level with the loop, the way an unwired step is left aside.
    const far: GeometryNode = {
      ...short,
      id: 'far',
      position: { x: rightmost + 600, y: short.position.y },
    };
    const routes = routeEdges([...nodes, far], edges, back);
    const lanes = edges
      .filter((edge) => back.has(edge.id))
      .map((edge) => routes.get(edge.id)?.laneX ?? null);

    expect(lanes.length).toBeGreaterThan(0);
    for (const lane of lanes) {
      expect(lane).not.toBeNull();
      expect(lane!).toBeGreaterThan(rightmost);
      expect(lane!).toBeLessThan(far.position.x);
    }
  });
});
