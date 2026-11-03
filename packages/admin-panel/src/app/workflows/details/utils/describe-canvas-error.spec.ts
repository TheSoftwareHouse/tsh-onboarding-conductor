import { describe, expect, it } from 'vitest';
import { describeCanvasError } from './describe-canvas-error';

describe('describeCanvasError', () => {
  it('ends a reason without a period before the hint', () => {
    expect(
      describeCanvasError("Expected property name or '}' in JSON at position 1 (line 1 column 2)"),
    ).toBe(
      "Expected property name or '}' in JSON at position 1 (line 1 column 2). Fix it in the JSON tab.",
    );
  });

  it('keeps a reason that already ends with a period as it is', () => {
    expect(describeCanvasError('The document has no `steps` array.')).toBe(
      'The document has no `steps` array. Fix it in the JSON tab.',
    );
  });
});
