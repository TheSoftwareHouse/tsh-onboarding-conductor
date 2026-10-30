import { describe, expect, it } from 'vitest';
import { isBoxVisible } from './viewport-visibility';

const BOX = { x: 100, y: 100, width: 200, height: 100 };
const PANE = { width: 500, height: 400 };
const MARGIN = 10;

describe('isBoxVisible', () => {
  it('accepts a box inside the pane', () => {
    expect(isBoxVisible(BOX, { x: 0, y: 0, zoom: 1 }, PANE, MARGIN)).toBe(true);
  });

  it('rejects a box the pane has narrowed past, as when the inspector opens', () => {
    const wide = { x: 225, y: 0, zoom: 1 };

    expect(isBoxVisible(BOX, wide, PANE, MARGIN)).toBe(false);
  });

  it('counts the zoom and the margin', () => {
    expect(isBoxVisible(BOX, { x: 0, y: 0, zoom: 2 }, PANE, MARGIN)).toBe(false);
    expect(isBoxVisible(BOX, { x: -95, y: 0, zoom: 1 }, PANE, MARGIN)).toBe(false);
    expect(isBoxVisible(BOX, { x: -85, y: 0, zoom: 1 }, PANE, MARGIN)).toBe(true);
  });
});
