import { isAxiosError } from 'axios';
import { describeRequestFailure } from './describe-request-failure';

export type ApiErrorKind = 'request-failed' | 'invalid-payload';

export interface ApiErrorOptions {
  kind?: ApiErrorKind;
  status?: number;
  code?: string | null;
  body?: unknown;
}

export class ApiError extends Error {
  readonly name = 'ApiError';
  readonly kind: ApiErrorKind;
  readonly status?: number;
  /** The engine's `code`, when the response body carried one. */
  readonly code: string | null;
  /** The raw response body, for domain readers that parse their own detail properties. */
  readonly body: unknown;

  constructor(message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.kind = options.kind ?? 'request-failed';
    this.status = options.status;
    this.code = options.code ?? null;
    this.body = options.body;
  }
}

function readCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('code' in body)) return null;
  return typeof body.code === 'string' ? body.code : null;
}

/** Converts any failure from an httpClient call into an ApiError. */
export function toApiError(
  cause: unknown,
  resourceLabel: string,
  describeCode?: (code: string) => string | undefined,
): ApiError {
  const status = isAxiosError(cause) ? cause.response?.status : undefined;
  const body = isAxiosError(cause) ? cause.response?.data : undefined;
  const code = readCode(body);
  const message =
    (code === null ? undefined : describeCode?.(code)) ??
    describeRequestFailure(status, cause, resourceLabel);
  return new ApiError(message, { status, code, body });
}

/** A 2xx response whose body failed its Zod schema. */
export function invalidPayloadError(message: string): ApiError {
  return new ApiError(message, { kind: 'invalid-payload' });
}
