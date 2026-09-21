/** Postgres' error class for a row that collides with a `UNIQUE` constraint or index. */
const UNIQUE_VIOLATION_CODE = '23505';

/** The two fields a Postgres driver error carries that identify which constraint rejected a write. */
type PostgresErrorFields = {
  code?: string;
  constraint?: string;
};

/**
 * Whether `error` is Postgres refusing a write because it collides with `constraint`. TypeORM
 * wraps the driver's error in a `QueryFailedError` whose `driverError` carries the fields, but a
 * caller may also pass the driver error itself. Matching the constraint by name keeps an unrelated
 * unique violation from being mistaken for the one the caller means to handle.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }

  const driverError = (error as { driverError?: PostgresErrorFields }).driverError;
  const fields: PostgresErrorFields = driverError ?? (error as PostgresErrorFields);

  return fields.code === UNIQUE_VIOLATION_CODE && fields.constraint === constraint;
}
