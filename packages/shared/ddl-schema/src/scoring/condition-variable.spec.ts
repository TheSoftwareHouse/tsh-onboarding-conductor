import {
  CONDITION_VARIABLE_TYPES,
  SCORE_CONDITION_VARIABLE,
  isConditionVariable,
} from './condition-variable';

describe('isConditionVariable', () => {
  it('recognizes a $-prefixed name as a condition variable', () => {
    expect(isConditionVariable('$score')).toBe(true);
  });

  it('does not treat an ordinary field name as a condition variable', () => {
    expect(isConditionVariable('score')).toBe(false);
  });
});

describe('CONDITION_VARIABLE_TYPES', () => {
  it('resolves $score to the number type', () => {
    expect(CONDITION_VARIABLE_TYPES[SCORE_CONDITION_VARIABLE]).toBe('number');
  });
});
