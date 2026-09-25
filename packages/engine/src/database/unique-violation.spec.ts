import { isUniqueViolation } from './unique-violation';

describe('isUniqueViolation', () => {
  const CONSTRAINT = 'uq_example';

  it('matches a TypeORM-wrapped driver error naming the constraint', () => {
    const error = Object.assign(new Error('duplicate key value violates unique constraint'), {
      driverError: { code: '23505', constraint: CONSTRAINT },
    });

    expect(isUniqueViolation(error, CONSTRAINT)).toBe(true);
  });

  it('matches a bare driver error naming the constraint', () => {
    expect(isUniqueViolation({ code: '23505', constraint: CONSTRAINT }, CONSTRAINT)).toBe(true);
  });

  it('rejects a unique violation on a different constraint', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'uq_other' }, CONSTRAINT)).toBe(false);
  });

  it('rejects a different Postgres error class on the same constraint', () => {
    expect(isUniqueViolation({ code: '23503', constraint: CONSTRAINT }, CONSTRAINT)).toBe(false);
  });

  it.each([null, undefined, 'duplicate', 42, new Error('plain')])(
    'rejects a value with no Postgres fields: %p',
    (value) => {
      expect(isUniqueViolation(value, CONSTRAINT)).toBe(false);
    },
  );
});
