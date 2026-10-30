import dagre from '@dagrejs/dagre';
import type { CanvasPosition } from './authored-document';
import { snapToGrid } from './authored-edits';
import type { ProjectedEdge, ProjectedStep } from './authored-projection';
import { HALF, listPortCenters, nodeHeight, nodeWidth } from './step-node-geometry';

export type Positions = Map<string, CanvasPosition>;

export const RANK_GAP = 70;
export const NODE_GAP = 50;

/** Edges the layout ranks by: drawn ones that go forward, since loops back enter from the side. */
function listForwardEdges(edges: ProjectedEdge[], back: Set<string>): ProjectedEdge[] {
  return edges.filter((edge) => !edge.dangling && !back.has(edge.id));
}

/** dagre ranks the steps, then each rank is re-placed top down under the ports wiring into it. */
export function layoutCanvas(
  steps: ProjectedStep[],
  edges: ProjectedEdge[],
  back: Set<string>,
): Positions {
  const forward = listForwardEdges(edges, back);
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'TB', nodesep: NODE_GAP, ranksep: RANK_GAP });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const step of steps) {
    graph.setNode(step.step.name, { width: nodeWidth(step), height: nodeHeight(step) });
  }
  for (const edge of forward) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);

  const byName = new Map(steps.map((step) => [step.step.name, step]));
  // dagre centres a rank on one line; top-align it so a rank shares its top edge.
  const centres = new Map<number, string[]>();
  for (const step of steps) {
    const { y } = graph.node(step.step.name);
    centres.set(y, [...(centres.get(y) ?? []), step.step.name]);
  }
  const positions: Positions = new Map();
  const ranks = new Map<number, string[]>();
  for (const [centre, names] of centres) {
    const top = centre - Math.max(...names.map((name) => nodeHeight(byName.get(name)!))) * HALF;
    ranks.set(top, names);
    for (const name of names) {
      const step = byName.get(name)!;
      positions.set(name, { x: graph.node(name).x - nodeWidth(step) * HALF, y: top });
    }
  }

  for (const [y, names] of [...ranks].sort(([a], [b]) => a - b)) {
    const centre = (name: string): number => {
      const step = byName.get(name)!;
      const ports = forward
        .filter((edge) => edge.target === name && positions.get(edge.source)!.y < y)
        .map((edge) => {
          const source = byName.get(edge.source)!;
          const port = listPortCenters(source).find((center) => center.name === edge.handle);
          return positions.get(edge.source)!.x + (port?.x ?? nodeWidth(source) * HALF);
        });
      return ports.length > 0
        ? ports.reduce((sum, x) => sum + x, 0) / ports.length
        : positions.get(name)!.x + nodeWidth(step) * HALF;
    };
    const wanted = names.map((name) => ({ name, x: centre(name) }));
    wanted.sort((a, b) => a.x - b.x);

    let right = Number.NEGATIVE_INFINITY;
    for (const { name, x } of wanted) {
      const width = nodeWidth(byName.get(name)!);
      const left = Math.max(x - width * HALF, right + NODE_GAP);
      positions.set(name, { x: left, y });
      right = left + width;
    }
  }

  return new Map([...positions].map(([name, position]) => [name, snapToGrid(position)]));
}
