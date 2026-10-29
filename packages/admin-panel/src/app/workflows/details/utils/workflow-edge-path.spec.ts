import { describe, expect, it } from 'vitest';
import { buildEdgePath, type EdgePoint } from './workflow-edge-path';

describe('buildEdgePath', () => {
  it('is empty for no points at all', () => {
    expect(buildEdgePath([])).toBe('');
  });

  it('draws a straight segment between two points, with no curve to round', () => {
    expect(
      buildEdgePath([
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ]),
    ).toBe('M 0,0 L 0,100');
  });

  it('rounds an interior corner instead of bending it sharply', () => {
    const path = buildEdgePath([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ]);

    // Stops short of the corner, curves through it, and resumes past it.
    expect(path).toBe('M 0,0 L 0,82 Q 0,100 18,100 L 100,100');
  });

  it('caps the radius at half a segment, so two corners on a short one never overrun', () => {
    const path = buildEdgePath([
      { x: 0, y: 0 },
      { x: 0, y: 4 },
      { x: 6, y: 4 },
    ]);

    expect(path).toBe('M 0,0 L 0,2 Q 0,4 3,4 L 6,4');
  });

  it('visits every point of a long route', () => {
    const points: EdgePoint[] = [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 60, y: 50 },
      { x: 60, y: 120 },
    ];

    const path = buildEdgePath(points);

    expect(path.match(/Q /g)).toHaveLength(2);
    expect(path.startsWith('M 0,0')).toBe(true);
    expect(path.endsWith('L 60,120')).toBe(true);
  });
});
