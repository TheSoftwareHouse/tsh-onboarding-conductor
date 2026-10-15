import { getBffBaseUrl } from '@/config/runtime-env';

/** Mirrors `packages/demo-bff/src/bnpl/dto/session-view.ts`; the web app has no dependency on it. */

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type Phase = 'collect' | 'processing' | 'result';
export type Decision = 'approved' | 'review' | 'declined';

export interface SessionField {
  name: string;
  type: string;
  required: boolean;
  value: JsonValue | null;
}

export interface SessionAccount {
  bankName: string | null;
  owner: string | null;
  iban: string | null;
  accountNumber: string | null;
  balance: number | null;
  currency: string | null;
}

export interface CreatedSession {
  token: string;
  persona: string;
}

export interface SessionView {
  phase: Phase;
  /** Name of the current step; `null` once the onboarding has ended. */
  step: string | null;
  /** Active fields of the current step; empty outside `collect`. */
  fields: SessionField[];
  data: Record<string, JsonValue>;
  decision?: Decision;
  /** Set when the credit check asked for another attempt; the phase is then `collect`. */
  retry?: true;
  attempt?: number;
  persona: string;
  accounts?: SessionAccount[];
}

export interface ProcessingView {
  phase: 'processing';
}

/** Field name to the engine's validation codes, as carried by a 400 `INVALID_STEP_DATA`. */
export type FieldErrors = Record<string, string[]>;

/** The BFF's error body: `{ statusCode, code, message }`, plus `errors` for field validation. */
export class BffError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors?: FieldErrors,
  ) {
    super(message);
    this.name = 'BffError';
  }
}

export const BFF_SESSIONS_PATH = '/v1/bnpl/sessions';

/** The BFF caps `?wait=` at 25 seconds. */
export const MAX_WAIT_SECONDS = 25;
const MILLISECONDS_PER_SECOND = 1000;
export const DEFAULT_WAIT_TOTAL_MS = 180 * MILLISECONDS_PER_SECOND;

interface ErrorBody {
  code?: string;
  message?: string;
  errors?: FieldErrors;
}

async function request<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`${getBffBaseUrl()}${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    throw new BffError(
      response.status,
      body.code ?? 'UNKNOWN',
      body.message ?? response.statusText,
      body.errors,
    );
  }

  return (await response.json()) as T;
}

function sessionPath(token: string, suffix = ''): string {
  return `${BFF_SESSIONS_PATH}/${encodeURIComponent(token)}${suffix}`;
}

export function createSession(persona: string, signal?: AbortSignal): Promise<CreatedSession> {
  return request<CreatedSession>(BFF_SESSIONS_PATH, { method: 'POST', body: { persona }, signal });
}

/** `wait` (seconds, 0-25) makes the BFF hold the request while the session is processing. */
export function getSession(
  token: string,
  options: { wait?: number; signal?: AbortSignal } = {},
): Promise<SessionView> {
  const query = options.wait === undefined ? '' : `?wait=${options.wait}`;
  return request<SessionView>(sessionPath(token, query), { signal: options.signal });
}

/** Resolves to the next view, or `{ phase: 'processing' }` once the step handed off to the engine. */
export function submitSession(
  token: string,
  values: Record<string, JsonValue>,
  signal?: AbortSignal,
): Promise<SessionView | ProcessingView> {
  return request<SessionView | ProcessingView>(sessionPath(token, '/submit'), {
    method: 'POST',
    body: { values },
    signal,
  });
}

export function runSession(token: string, signal?: AbortSignal): Promise<ProcessingView> {
  return request<ProcessingView>(sessionPath(token, '/run'), { method: 'POST', signal });
}

export interface WaitForResultOptions {
  /** Seconds each long-poll request may be held, at most 25. */
  perRequestSeconds?: number;
  /** Total budget across requests. */
  totalMs?: number;
  signal?: AbortSignal;
}

export type WaitOutcome =
  | { kind: 'result'; view: SessionView }
  | { kind: 'retry'; view: SessionView }
  | { kind: 'timeout'; view: SessionView };

/**
 * Long-polls `GET ?wait=` until the session reaches `result`, asks for a `retry`, or the budget
 * runs out. A request that returns while still `processing` simply starts the next one. Aborting
 * `signal` rejects with the fetch's `AbortError`.
 */
export async function waitForResult(
  token: string,
  options: WaitForResultOptions = {},
): Promise<WaitOutcome> {
  const perRequestSeconds = Math.min(
    options.perRequestSeconds ?? MAX_WAIT_SECONDS,
    MAX_WAIT_SECONDS,
  );
  const totalMs = options.totalMs ?? DEFAULT_WAIT_TOTAL_MS;
  const startedAt = Date.now();

  for (;;) {
    const view = await getSession(token, { wait: perRequestSeconds, signal: options.signal });

    if (view.phase === 'result') {
      return { kind: 'result', view };
    }
    if (view.retry) {
      return { kind: 'retry', view };
    }
    if (Date.now() - startedAt >= totalMs) {
      return { kind: 'timeout', view };
    }
  }
}

export interface PersonaSummary {
  id: string;
  name: string;
  story: string;
  expectedBand: Decision;
  expectedScore: number;
  /** Test-only personae: not offered as a card on the start page. */
  hidden?: boolean;
}

/** The demo personae the start page offers (`GET /v1/bnpl/personas`). */
export function listPersonas(signal?: AbortSignal): Promise<PersonaSummary[]> {
  return request<PersonaSummary[]>('/v1/bnpl/personas', { signal });
}
