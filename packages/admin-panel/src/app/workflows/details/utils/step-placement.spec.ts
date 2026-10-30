import { describe, expect, it } from 'vitest';
import type { AuthoredDocument } from './authored-document';
import { GRID_SIZE } from './authored-edits';
import { projectDocument } from './authored-projection';
import { NODE_GAP, RANK_GAP } from './canvas-layout';
import { BASE_NODE_HEIGHT, MIN_NODE_WIDTH, nodeHeight, nodeWidth } from './step-node-geometry';
import { placeFreeSpot, pickSpotBelow, placeNewSteps, readStepPosition } from './step-placement';

const FORM = { fields: { a: { type: 'text', required: true } } };
const ORIGIN = { x: 0, y: 0 };

describe('pickSpotBelow', () => {
  it('centres the first step on the given point', () => {
    const spot = pickSpotBelow([], { x: 500, y: 300 });

    expect(spot).toEqual({
      x: 500 - MIN_NODE_WIDTH / 2,
      y: 300 - BASE_NODE_HEIGHT / 2,
    });
  });

  it('puts a step under the selected one, a rank gap below it', () => {
    const anchor = { x: 80, y: 40, width: MIN_NODE_WIDTH, height: BASE_NODE_HEIGHT };

    expect(pickSpotBelow([anchor], ORIGIN, anchor)).toEqual({
      x: 80,
      y: 40 + BASE_NODE_HEIGHT + RANK_GAP,
    });
  });

  it('moves below a step already there', () => {
    const anchor = { x: 0, y: 0, width: MIN_NODE_WIDTH, height: BASE_NODE_HEIGHT };
    const taken = { x: 0, y: BASE_NODE_HEIGHT + RANK_GAP, width: MIN_NODE_WIDTH, height: 100 };

    expect(pickSpotBelow([anchor, taken], ORIGIN, anchor).y).toBe(
      taken.y + taken.height + NODE_GAP,
    );
  });
});

describe('placeFreeSpot', () => {
  it('snaps to the grid', () => {
    const spot = placeFreeSpot([], { x: 13, y: 21 }, MIN_NODE_WIDTH, BASE_NODE_HEIGHT);

    expect(spot.x % GRID_SIZE).toBe(0);
    expect(spot.y % GRID_SIZE).toBe(0);
  });

  it('shifts right past a step in the way, and records its own box', () => {
    const boxes = [{ x: 0, y: 0, width: MIN_NODE_WIDTH, height: BASE_NODE_HEIGHT }];

    const first = placeFreeSpot(boxes, ORIGIN, MIN_NODE_WIDTH, BASE_NODE_HEIGHT);
    const second = placeFreeSpot(boxes, ORIGIN, MIN_NODE_WIDTH, BASE_NODE_HEIGHT);

    // Snapping may round down by under one grid cell.
    expect(first.x).toBeGreaterThan(MIN_NODE_WIDTH + NODE_GAP - GRID_SIZE);
    expect(second.x).toBeGreaterThan(first.x + MIN_NODE_WIDTH + NODE_GAP - GRID_SIZE);
    expect(boxes).toHaveLength(3);
  });
});

describe('placeNewSteps', () => {
  const doc: AuthoredDocument = {
    initial: 'a',
    steps: [
      { name: 'a', type: 'form', config: FORM, edges: { success: 'b' } },
      { name: 'b', type: 'terminal', config: { outcome: 'approved' } },
    ],
  };

  it('places a step the layout has not seen under the port that wires into it', () => {
    const projection = projectDocument(doc);
    const [a] = projection.steps;
    const placed = placeNewSteps(projection, new Map([['a', { x: 160, y: 0 }]]));

    const b = placed.get('b')!;
    expect(b.y).toBeGreaterThanOrEqual(nodeHeight(a!) + RANK_GAP);
    expect(b.x).toBeGreaterThanOrEqual(160 - nodeWidth(projection.steps[1]!));
  });

  it('puts the first step of an empty layout at the origin row', () => {
    const projection = projectDocument({ steps: [doc.steps[1]!] });

    expect(placeNewSteps(projection, new Map()).get('b')!.y).toBe(0);
  });

  it('keeps a step the layout already knows, and prefers its saved position', () => {
    const saved: AuthoredDocument = {
      steps: [{ ...doc.steps[1]!, meta: { position: { x: 13, y: 21 } } }],
    };
    const projection = projectDocument(saved);

    expect(readStepPosition(projection.steps[0]!)).toEqual({ x: 16, y: 24 });
    expect(placeNewSteps(projection, new Map()).has('b')).toBe(false);
  });
});
