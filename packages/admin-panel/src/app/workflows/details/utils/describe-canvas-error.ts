const CANVAS_ERROR_HINT = 'Fix it in the JSON tab.';

/** The canvas error's body: the reason as a sentence, then where to fix it. */
export function describeCanvasError(reason: string): string {
  const trimmed = reason.trimEnd();
  return `${trimmed.endsWith('.') ? trimmed : `${trimmed}.`} ${CANVAS_ERROR_HINT}`;
}
