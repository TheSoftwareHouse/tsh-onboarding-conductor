import { describe, expect, it } from 'vitest';
import { findFailedStep } from './find-failed-step';

const TEXT = JSON.stringify({ steps: [{ name: 'collect' }, { name: 'verify' }] });

describe('findFailedStep', () => {
  it('names the step a path indexes, from the text that was compiled', () => {
    expect(findFailedStep(TEXT, 'steps[1].edges.success')).toBe('verify');
  });

  it('names none for a path outside the steps', () => {
    expect(findFailedStep(TEXT, 'initial')).toBeNull();
    expect(findFailedStep(TEXT, undefined)).toBeNull();
  });

  it('names none when the index is past the last step or the text is not JSON', () => {
    expect(findFailedStep(TEXT, 'steps[5]')).toBeNull();
    expect(findFailedStep('{', 'steps[0]')).toBeNull();
  });
});
