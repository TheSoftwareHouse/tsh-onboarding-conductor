/** How long the canvas takes to pan to a step, in milliseconds. */
export const PAN_DURATION_MS = 300;

/** Screen pixels between the overlays along the top and the graph, after a fit. */
export const START_STEP_MARGIN = 24;

/** Screen pixels the selected step keeps clear of the pane's edges. */
export const VISIBLE_MARGIN = 16;

/** Share of the canvas a fit leaves empty at its sides and bottom. */
export const FIT_SIDE_PADDING = 0.05;

/** The lowest zoom the canvas opens at, so a large graph stays readable and is cropped instead. */
export const OPEN_MIN_ZOOM = 0.6;

/** A fit never zooms past 100%, so a graph of one or two steps is not blown up. */
export const FIT_MAX_ZOOM = 1;

/** The highlighted edge's arrowhead: React Flow's marker API takes only a colour string. */
export const HIGHLIGHT_MARKER_COLOR = 'var(--color-tsh-blue-500)';

/** React Flow's class on a node's wrapper, which carries the step name in `data-id`. */
export const NODE_SELECTOR = '.react-flow__node';

/** Where the palette's open or closed state is remembered, per browser. */
export const PALETTE_STORAGE_KEY = 'tsh.canvas.paletteOpen';
