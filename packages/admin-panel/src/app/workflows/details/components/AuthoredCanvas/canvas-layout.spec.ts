import { describe, expect, it } from 'vitest';
import { findBackEdges, projectDocument, type AuthoredDocument } from './authored-graph';
import { nodeHeight, type AuthoredStepNode } from './AuthoredStepNode';
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
  const back = findBackEdges(steps, edges);
  const positions = layoutCanvas(steps, edges, back);
  const nodes: AuthoredStepNode[] = steps.map((step) => ({
    id: step.step.name,
    type: 'authoredStep',
    position: positions.get(step.step.name)!,
    data: { ...step, hasError: false, readOnly: false, isDropTarget: false },
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
});
