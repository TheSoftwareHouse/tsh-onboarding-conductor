/**
 * Turns the polyline dagre routed an edge along into an SVG path, and finds the point on it to
 * hang the label from.
 *
 * dagre already solves the hard part. It inserts a dummy node on every rank an edge crosses, so
 * the polyline it returns goes around the boxes in between rather than through them — including
 * for a retry loop that climbs back up the drawing. Drawing anything other than these points
 * throws that away and reintroduces the crossings.
 */

export interface EdgePoint {
  x: number;
  y: number;
}

/**
 * Corner radius where two segments meet, capped per corner at half the shorter segment so the two
 * corners at either end of a short one cannot overrun each other.
 *
 * Generous on purpose: a bend this soft reads as a flowing line rather than a right angle with the
 * point filed off. It costs nothing in correctness — a quadratic curve lies inside the triangle of
 * its own start, control and end points, so rounding only ever cuts the inside of a corner and can
 * never bow the line outward into a box dagre routed it around.
 */
const CORNER_RADIUS = 18;

const distance = (from: EdgePoint, to: EdgePoint): number =>
  Math.hypot(to.x - from.x, to.y - from.y);

/** Walks `length` from `from` towards `to`. */
const along = (from: EdgePoint, to: EdgePoint, length: number): EdgePoint => {
  const total = distance(from, to);

  if (total === 0) {
    return { ...from };
  }

  const travelled = length / total;

  return {
    x: from.x + (to.x - from.x) * travelled,
    y: from.y + (to.y - from.y) * travelled,
  };
};

/**
 * The same walk, but never past a segment's midpoint, so the corners at either end of a short
 * segment cannot overrun each other and turn the curve inside out.
 */
const towardsCorner = (from: EdgePoint, to: EdgePoint, length: number): EdgePoint =>
  along(from, to, Math.min(length, distance(from, to) / 2));

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * An SVG path through every point, with the corners rounded. Each interior point becomes a
 * quadratic curve that starts before it and ends after it, so the line changes direction without
 * a hard bend.
 */
export function buildEdgePath(points: readonly EdgePoint[]): string {
  if (points.length === 0) {
    return '';
  }

  const [first] = points;

  if (points.length === 1) {
    return `M ${round(first!.x)},${round(first!.y)}`;
  }

  let path = `M ${round(first!.x)},${round(first!.y)}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;

    const entry = towardsCorner(corner, previous, CORNER_RADIUS);
    const exit = towardsCorner(corner, next, CORNER_RADIUS);

    path += ` L ${round(entry.x)},${round(entry.y)}`;
    path += ` Q ${round(corner.x)},${round(corner.y)} ${round(exit.x)},${round(exit.y)}`;
  }

  const last = points[points.length - 1]!;
  path += ` L ${round(last.x)},${round(last.y)}`;

  return path;
}

/**
 * The point half the polyline's length along it, which is where the label sits.
 *
 * By length rather than by index: dagre spaces its points one per crossed rank, so an edge that
 * skips three ranks has its middle *index* nowhere near its middle, and the label would drift
 * towards whichever end happened to need fewer bends.
 */
export function findEdgeMidpoint(points: readonly EdgePoint[]): EdgePoint {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  if (points.length === 1) {
    return { ...points[0]! };
  }

  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1]!, points[index]!);
  }

  let remaining = total / 2;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const segment = distance(from, to);

    if (segment >= remaining) {
      return along(from, to, remaining);
    }

    remaining -= segment;
  }

  return { ...points[points.length - 1]! };
}
