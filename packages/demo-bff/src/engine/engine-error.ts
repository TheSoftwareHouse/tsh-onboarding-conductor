export type EngineFieldErrors = Record<string, string[]>;

/**
 * Internal: an engine call that did not produce a usable 2xx. It is never sent to the caller —
 * the BFF's own exceptions (added with the routes) map it onto the BFF contract.
 *
 * `status` is `null` for a transport failure (refused connection, timeout, unreadable body),
 * which is the BFF's 502 whatever the engine said or did not say.
 *
 * The engine answers 4xx in two shapes: `{ code, message, errors? }` from its own code, and
 * Nest's `{ message: string[], error, statusCode }` from the global ValidationPipe, which has
 * no `code`. Branch on `code`; an absent one on a 4xx is a defect in the BFF's own request.
 */
export class EngineError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string | undefined,
    message: string,
    readonly errors?: EngineFieldErrors,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'EngineError';
  }

  get isTransport(): boolean {
    return this.status === null;
  }

  /** A 400 from the ValidationPipe: no `code`, so the BFF built a bad request. */
  get isValidationShape(): boolean {
    return this.status === 400 && this.code === undefined;
  }

  static transport(message: string): EngineError {
    return new EngineError(null, undefined, message);
  }

  static fromResponse(status: number, body: unknown): EngineError {
    const record = isRecord(body) ? body : {};
    const code = typeof record.code === 'string' ? record.code : undefined;
    const message = Array.isArray(record.message)
      ? record.message.join('; ')
      : typeof record.message === 'string'
        ? record.message
        : `Engine responded ${status}`;
    const errors = isRecord(record.errors) ? (record.errors as EngineFieldErrors) : undefined;

    return new EngineError(status, code, message, errors, body);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
