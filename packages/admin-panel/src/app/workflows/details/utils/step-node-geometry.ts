import {
  isBranched,
  listScoringRules,
  toArmHandle,
  UNWIRED,
  type CanvasPosition,
} from './authored-document';
import { type ProjectedStep } from './authored-projection';
import { describeCondition } from './describe-condition';
import { GRID_SIZE } from './authored-edits';

/** What geometry and routing read of a canvas node; a React Flow node whose `data` extends `ProjectedStep` fits. */
export type GeometryNode = {
  id: string;
  position: CanvasPosition;
  data: ProjectedStep & { hasError?: boolean };
};

export const HALF = 0.5;
export const MIN_NODE_WIDTH = 200;
const PORT_CHAR_WIDTH = 6.5;
const PORT_PADDING = 20;
const BASE_NODE_HEIGHT_CELLS = 11;
const EXTRA_LINE_HEIGHT_CELLS = 2;
const WIDTH_CELL_GRID_CELLS = 2;
/** Whole grid cells, so a snapped node's bottom edge lands on the grid too: the header, the summary and the port labels. */
export const BASE_NODE_HEIGHT = GRID_SIZE * BASE_NODE_HEIGHT_CELLS;
/** One optional line — the included sections, or the first issue — in whole grid cells. */
const EXTRA_LINE_HEIGHT = GRID_SIZE * EXTRA_LINE_HEIGHT_CELLS;

export type PortSlot = {
  name: string;
  /** What the node prints under the handle; a custom step's transition shows its status. */
  label: string;
  detail?: string;
  optional: boolean;
  unwired: boolean;
  /** An arm or transition on this port lost its target. */
  unfinished: boolean;
  stray: boolean;
  width: number;
};

/** Caches a per-step result by the step object, which is never mutated, so a drag re-reads it instead of rebuilding it every frame. */
function cacheByStep<S extends ProjectedStep, T>(compute: (step: S) => T): (step: S) => T {
  const cache = new WeakMap<S, T>();
  return (step) => {
    if (cache.has(step)) return cache.get(step)!;
    const result = compute(step);
    cache.set(step, result);
    return result;
  };
}

export const listSlots = cacheByStep((step: ProjectedStep): PortSlot[] => {
  const known = step.ports.kind === 'known' ? step.ports.ports : [];
  return [
    ...known.flatMap((port) => {
      const label = port.label ?? port.name;
      const edge = step.step.edges?.[port.name];
      // A branched port splits into one handle per branch, numbered in the order they are tried.
      if (isBranched(edge)) {
        let order = 0;
        return edge.map((arm, armIndex) => {
          const guarded = arm.when !== undefined;
          if (guarded) order += 1;
          return {
            name: toArmHandle(port.name, armIndex),
            label: `${label}:${guarded ? order : 'else'}`,
            detail: guarded ? `if ${describeCondition(arm.when)}` : 'otherwise',
            optional: false,
            unwired: false,
            unfinished: arm.target === UNWIRED,
            stray: false,
          };
        });
      }
      return [
        {
          name: port.name,
          label,
          detail: port.detail,
          optional: port.optional === true,
          unwired: step.unwired.includes(port.name),
          unfinished: step.unfinished.includes(port.name),
          stray: false,
        },
      ];
    }),
    ...step.strayPorts.map((name) => ({
      name,
      label: name,
      optional: false,
      unwired: false,
      unfinished: false,
      stray: true,
    })),
  ].map((slot) => ({ ...slot, width: slot.label.length * PORT_CHAR_WIDTH + PORT_PADDING }));
});

/** Where each port's handle sits along the bottom edge, so the layout can place targets under their port. */
export const listPortCenters = cacheByStep((step: ProjectedStep): { name: string; x: number }[] => {
  const slots = listSlots(step);
  let offset = (nodeWidth(step) - slots.reduce((sum, slot) => sum + slot.width, 0)) * HALF;
  return slots.map((slot) => {
    // On the grid, so a target laid out under this port stays under it once both nodes are snapped.
    const x = Math.round((offset + slot.width * HALF) / GRID_SIZE) * GRID_SIZE;
    offset += slot.width;
    return { name: slot.name, x };
  });
});

/** Grows by a line each for the included sections, the scores and an issue, so a plain step stays compact. */
export const nodeHeight = cacheByStep((step: ProjectedStep & { hasError?: boolean }): number => {
  const hasIncludes = (step.step.include ?? []).length > 0;
  const hasScores = listScoringRules(step.step).length > 0;
  const hasIssue = step.issues.length > 0 || step.hasError === true;
  return (
    BASE_NODE_HEIGHT +
    EXTRA_LINE_HEIGHT * (Number(hasIncludes) + Number(hasScores) + Number(hasIssue))
  );
});

export const nodeWidth = cacheByStep((step: ProjectedStep): number => {
  const ports = listSlots(step).reduce((sum, slot) => sum + slot.width, 0);
  // Rounded up to two grid cells, so both the right edge and the centre (the entry handle) land on the grid.
  const cell = GRID_SIZE * WIDTH_CELL_GRID_CELLS;
  return Math.ceil(Math.max(MIN_NODE_WIDTH, ports) / cell) * cell;
});
