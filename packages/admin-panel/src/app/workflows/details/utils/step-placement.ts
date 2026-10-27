import { snapToGrid } from './authored-edits';
import type { CanvasPosition } from './authored-document';
import type { ProjectedEdge, ProjectedStep } from './authored-projection';
import { NODE_GAP, RANK_GAP, type Positions } from './canvas-layout';
import {
  BASE_NODE_HEIGHT,
  HALF,
  listPortCenters,
  MIN_NODE_WIDTH,
  nodeHeight,
  nodeWidth,
} from './step-node-geometry';

/** Flow pixels between a step placed beside the graph and the last one. */
const PLACE_GAP = 80;

export interface Projection {
  steps: ProjectedStep[];
  edges: ProjectedEdge[];
}

/** A step's top-left corner and size, in flow pixels. */
export type Box = CanvasPosition & { width: number; height: number };

/** The position saved in the step's `meta`, snapped so one saved before the grid existed still lines up. */
export function readStepPosition(step: ProjectedStep): CanvasPosition | null {
  const position = step.step.meta?.position as Partial<CanvasPosition> | undefined;
  return typeof position?.x === 'number' && typeof position.y === 'number'
    ? snapToGrid({ x: position.x, y: position.y })
    : null;
}

/** A snapped spot at or right of `wanted` that clears every box; the spot's box joins `boxes`. */
export function placeFreeSpot(
  boxes: Box[],
  wanted: CanvasPosition,
  width: number,
  height: number,
): CanvasPosition {
  const spot = { ...wanted };
  const overlaps = (box: Box): boolean =>
    spot.x < box.x + box.width + NODE_GAP &&
    box.x < spot.x + width + NODE_GAP &&
    spot.y < box.y + box.height + NODE_GAP &&
    box.y < spot.y + height + NODE_GAP;
  for (let blocker = boxes.find(overlaps); blocker; blocker = boxes.find(overlaps)) {
    spot.x = blocker.x + blocker.width + NODE_GAP;
  }
  const snapped = snapToGrid(spot);
  boxes.push({ ...snapped, width, height });
  return snapped;
}

/** Gives every step the layout has not seen a spot: under the port that first wires into it, else to the right. */
export function placeNewSteps({ steps, edges }: Projection, laidOut: Positions): Positions {
  const result: Positions = new Map(laidOut);
  const byName = new Map(steps.map((step) => [step.step.name, step]));
  const find = (step: ProjectedStep): CanvasPosition | undefined =>
    readStepPosition(step) ?? result.get(step.step.name);
  let fallbackX = Math.max(0, ...[...result.values()].map((position) => position.x)) + PLACE_GAP;
  const boxes = steps.flatMap((step) => {
    const position = find(step);
    return position ? [{ ...position, width: nodeWidth(step), height: nodeHeight(step) }] : [];
  });

  for (const step of steps) {
    const name = step.step.name;
    if (find(step)) continue;
    const incoming = edges.find((edge) => {
      const source = byName.get(edge.source);
      return edge.target === name && source !== undefined && find(source) !== undefined;
    });
    const source = incoming ? byName.get(incoming.source) : undefined;
    const origin = source ? find(source) : undefined;
    if (incoming && source && origin) {
      const port = listPortCenters(source).find((center) => center.name === incoming.handle);
      const wanted = {
        x: origin.x + (port?.x ?? 0) - nodeWidth(step) * HALF,
        y: origin.y + nodeHeight(source) + RANK_GAP,
      };
      result.set(name, placeFreeSpot(boxes, wanted, nodeWidth(step), nodeHeight(step)));
    } else {
      const wanted = { x: fallbackX, y: 0 };
      result.set(name, placeFreeSpot(boxes, wanted, nodeWidth(step), nodeHeight(step)));
      fallbackX += nodeWidth(step) + NODE_GAP;
    }
  }
  return result;
}

/** Where a step added by click goes: under the anchor step, else at `center`, and below any step already there. */
export function pickSpotBelow(
  occupied: readonly Box[],
  center: CanvasPosition,
  anchor?: Box,
): CanvasPosition {
  let spot = anchor
    ? { x: anchor.x, y: anchor.y + anchor.height + RANK_GAP }
    : { x: center.x - MIN_NODE_WIDTH * HALF, y: center.y - BASE_NODE_HEIGHT * HALF };
  const findBlocker = (at: CanvasPosition): Box | undefined =>
    occupied.find(
      (box) =>
        at.x < box.x + box.width &&
        at.x + MIN_NODE_WIDTH > box.x &&
        at.y < box.y + box.height &&
        at.y + BASE_NODE_HEIGHT > box.y,
    );
  for (let blocker = findBlocker(spot); blocker; blocker = findBlocker(spot)) {
    spot = { x: spot.x, y: blocker.y + blocker.height + NODE_GAP };
  }
  return spot;
}
