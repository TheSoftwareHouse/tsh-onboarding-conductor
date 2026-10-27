import type { Box } from './step-placement';

/** React Flow's pan and zoom: a flow point maps to the screen as `point * zoom + offset`. */
export interface ViewportTransform {
  x: number;
  y: number;
  zoom: number;
}

/** Whether `box`, in flow pixels, lies fully inside a pane of `pane` screen pixels, `margin` clear of its edges. */
export function isBoxVisible(
  box: Box,
  viewport: ViewportTransform,
  pane: { width: number; height: number },
  margin: number,
): boolean {
  const left = box.x * viewport.zoom + viewport.x;
  const top = box.y * viewport.zoom + viewport.y;
  return (
    left >= margin &&
    top >= margin &&
    left + box.width * viewport.zoom <= pane.width - margin &&
    top + box.height * viewport.zoom <= pane.height - margin
  );
}
