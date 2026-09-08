/**
 * Module-private: the only way to set or read this marker is through the two functions below, so
 * a throw site cannot fake it by guessing a string key.
 */
const AUDIT_RECORDED = Symbol('auditRecorded');

/**
 * Marks an error as already having written its own audit row, so `ApiFailureAuditFilter` does not
 * double-log it - one event stays one row. Set as a **non-enumerable** property: this marker rides
 * on exceptions that get serialized into HTTP responses and into JSON log lines, and must never
 * surface in either.
 */
export function markAuditRecorded<E>(error: E): E {
  Object.defineProperty(error, AUDIT_RECORDED, {
    value: true,
    enumerable: false,
    configurable: true,
  });

  return error;
}

/** Whether `markAuditRecorded` has already been called on this error. */
export function isAuditRecorded(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  return Reflect.get(error, AUDIT_RECORDED) === true;
}
