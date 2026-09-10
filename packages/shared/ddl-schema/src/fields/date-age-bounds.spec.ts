import { createStepDataValidator } from '../workflow-step-validator';
import type { NormalizedWorkflowStep } from '../workflow-contract';
import { validateAndNormalizeUntypedSteps } from '../testing/untyped-steps.helper';

/** A date exactly `years` whole years before today, in UTC. */
const yearsAgo = (years: number): string => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
};

const buildWorkflow = (validation: unknown) => ({
  id: 'age-bounds',
  version: 1,
  name: 'Age bounds',
  initial: 'collect_person',
  steps: [
    {
      name: 'collect_person',
      status: 'awaiting_user',
      data: { dateOfBirth: { type: 'date', required: true, validation } },
      transitions: [{ status: 'success', target: 'approved' }],
    },
    { name: 'approved', status: 'approved', data: {}, transitions: [] },
  ],
});

const buildValidator = (validation: unknown) => {
  const definition = validateAndNormalizeUntypedSteps(buildWorkflow(validation));
  return createStepDataValidator(definition.stepsByName.collect_person as NormalizedWorkflowStep);
};

describe('date age bounds', () => {
  it('accepts a date old enough for minAgeYears and rejects one that is not', () => {
    const validator = buildValidator({ minAgeYears: 18 });

    expect(validator({ dateOfBirth: yearsAgo(18) })).toBe(true);
    expect(validator({ dateOfBirth: yearsAgo(44) })).toBe(true);
    expect(validator({ dateOfBirth: yearsAgo(17) })).toBe(false);
  });

  it('rejects a date in the future, which is younger than any minimum age', () => {
    const validator = buildValidator({ minAgeYears: 0 });

    expect(validator({ dateOfBirth: yearsAgo(-1) })).toBe(false);
  });

  it('rejects a date older than maxAgeYears', () => {
    const validator = buildValidator({ minAgeYears: 18, maxAgeYears: 120 });

    expect(validator({ dateOfBirth: yearsAgo(119) })).toBe(true);
    expect(validator({ dateOfBirth: yearsAgo(121) })).toBe(false);
  });

  it('resolves the bound per submission rather than at compile time', () => {
    const validator = buildValidator({ minAgeYears: 18 });
    // The day before an 18th birthday fails; the birthday itself passes. Both are evaluated
    // against the same cached validator, so the bound cannot have been frozen when it compiled.
    const dayBeforeEighteenth = new Date();
    dayBeforeEighteenth.setUTCFullYear(dayBeforeEighteenth.getUTCFullYear() - 18);
    dayBeforeEighteenth.setUTCDate(dayBeforeEighteenth.getUTCDate() + 1);

    expect(validator({ dateOfBirth: yearsAgo(18) })).toBe(true);
    expect(validator({ dateOfBirth: dayBeforeEighteenth.toISOString().slice(0, 10) })).toBe(false);
  });

  it('holds every selected date to the bound when combined with manyOf', () => {
    const validator = buildValidator({ manyOf: [yearsAgo(20), yearsAgo(10)], minAgeYears: 18 });

    expect(validator({ dateOfBirth: [yearsAgo(20)] })).toBe(true);
    expect(validator({ dateOfBirth: [yearsAgo(10)] })).toBe(false);
  });

  it.each([
    ['a non-integer bound', { minAgeYears: 18.5 }],
    ['a negative bound', { minAgeYears: -1 }],
    ['a minimum above the maximum', { minAgeYears: 40, maxAgeYears: 10 }],
    ['an unknown validation key', { minAgeYearz: 18 }],
  ])('rejects the workflow for %s', (_label, validation) => {
    expect(() => validateAndNormalizeUntypedSteps(buildWorkflow(validation))).toThrow();
  });

  it('leaves a oneOf literal unchecked against the bound, so loading stays time-independent', () => {
    // '1990-01-01' satisfies minAgeYears today and would not in a century; either way the
    // document must load, because a workflow that stops loading with the calendar is unusable.
    expect(() =>
      validateAndNormalizeUntypedSteps(buildWorkflow({ oneOf: ['2020-01-01'], minAgeYears: 18 })),
    ).not.toThrow();
  });
});
