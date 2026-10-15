/**
 * Algoan answered a request with a 4xx. Carries Algoan's own `{ code, message, status }` so the
 * provider can tell a reused customer identifier (`ALREADY_EXISTS`) from a malformed analysis.
 * `reason` is Algoan's `message`; it may echo caller input, so it stays off `message`.
 */
export class AlgoanRequestRejectedError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly reason: string | undefined,
  ) {
    super(`Algoan rejected the request: status=${status} code=${code ?? 'unknown'}`);
    this.name = 'AlgoanRequestRejectedError';
  }
}
