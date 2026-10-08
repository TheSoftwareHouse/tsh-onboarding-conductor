import { HttpStatusCode, isAxiosError, type AxiosResponse } from 'axios';
import { z } from 'zod';
import { invalidPayloadError, toApiError, type ApiError } from '@/services/api/api-error';
import { httpClient } from '@/services/api/http-client';

/** The engine paths this module reads and writes, beside the only code that requests them. */
export const ENCRYPTION_ENDPOINTS = {
  adminEncryption: '/v1/admin/encryption',
  adminEncryptionKeys: '/v1/admin/encryption/keys',
  adminEncryptionRotation: '/v1/admin/encryption/rotation',
  adminEncryptionReencryption: '/v1/admin/encryption/reencryption',
} as const;

export interface EncryptionKey {
  /** The id written into every envelope this key produced. */
  id: string;
  createdAt: string;
  /**
   * The operator who turned encryption on or added this key, as the bearer token identified them,
   * or the engine's unknown-actor marker when admin authentication is off. `null` only for a row
   * inserted outside the API: every key the engine creates records who asked for it.
   */
  createdBy: string | null;
  /** When the key became — or, while `pendingActivation`, will become — the one new writes use. */
  activatedAt: string;
  /** When this key was retired; `null` while it is still part of the ring. */
  deletedAt: string | null;
  /** Whether this is the key encrypting new writes right now. */
  active: boolean;
  /**
   * Added but not yet active: the engine holds a new key back for a grace window so every engine
   * process learns of it before any of them writes with it.
   */
  pendingActivation: boolean;
}

/**
 * How often the engine rotates the key on its own. A closed set the engine defines and this panel
 * only renders — `EncryptionKeyRotationInterval` in `engine.openapi.json`.
 */
export type EncryptionKeyRotationInterval = '48h' | '96h' | '1w' | '2w' | '1mo';

export interface EncryptionRotation {
  /** The schedule in force, or `null` when the engine rotates only on request. */
  interval: EncryptionKeyRotationInterval | null;
  /**
   * When the next automatic rotation falls due — the active key's creation plus `interval`. Null
   * whenever `interval` is, and in the past for a schedule that has come due but whose rotation
   * the engine has not run yet.
   */
  nextRotationAt: string | null;
}

export interface EncryptionProgress {
  /**
   * Onboardings the background sweep still has to move: rows not yet on the active key while
   * encryption is on, rows still encrypted while it is off.
   */
  pending: number;
  /** Every stored onboarding. */
  total: number;
}

export interface EncryptionState {
  /** The target state the operator chose — a key row exists that has not been retired. */
  enabled: boolean;
  /**
   * Whether the engine process has its key-encryption key (`ENCRYPTION_KEY`) configured. Without
   * it encryption can be neither turned on nor rotated.
   */
  keyConfigured: boolean;
  /** Full history, most recent first. */
  keys: EncryptionKey[];
  /** The automatic-rotation schedule the active key carries; empty while encryption is off. */
  rotation: EncryptionRotation;
  progress: EncryptionProgress;
  /**
   * Whether a request to move every stored onboarding onto the active key is still outstanding.
   * While it is, `progress.pending` counts rows on a superseded key as work; otherwise it does
   * not, because rotation is lazy and such a row is already in an acceptable state.
   */
  reencrypting: boolean;
}

/**
 * Offered in the order an operator reads them: shortest schedule first. Typed as a non-empty
 * tuple so it can be handed straight to `z.enum` below, the same way
 * `ENCRYPTION_WRITE_ERROR_CODES` is.
 */
export const ROTATION_INTERVALS: readonly [
  EncryptionKeyRotationInterval,
  ...EncryptionKeyRotationInterval[],
] = ['48h', '96h', '1w', '2w', '1mo'];

const encryptionKeySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  activatedAt: z.string(),
  deletedAt: z.string().nullable(),
  active: z.boolean(),
  pendingActivation: z.boolean(),
});

const encryptionRotationSchema = z.object({
  interval: z.enum(ROTATION_INTERVALS).nullable(),
  nextRotationAt: z.string().nullable(),
});

const encryptionProgressSchema = z.object({
  pending: z.number().int().min(0),
  total: z.number().int().min(0),
});

const encryptionStateResponseSchema = z.object({
  enabled: z.boolean(),
  keyConfigured: z.boolean(),
  keys: z.array(encryptionKeySchema),
  rotation: encryptionRotationSchema,
  progress: encryptionProgressSchema,
  reencrypting: z.boolean(),
});

const addEncryptionKeyResponseSchema = z.object({
  id: z.string(),
});

export const ENCRYPTION_WRITE_ERROR_CODES = [
  'ENCRYPTION_DISABLED',
  'ENCRYPTION_KEY_NOT_CONFIGURED',
  'ENCRYPTION_KEY_RING_CONFLICT',
] as const;

/** The refusals the engine names in a 409 or 503 body; each gets its own operator-facing copy. */
export type EncryptionRefusalCode = (typeof ENCRYPTION_WRITE_ERROR_CODES)[number];

const WRITE_ERROR_MESSAGES: Record<EncryptionRefusalCode, string> = {
  ENCRYPTION_DISABLED: 'Encryption is turned off, so there is no key to rotate.',
  ENCRYPTION_KEY_NOT_CONFIGURED:
    'The engine has no ENCRYPTION_KEY configured. Set it and restart the engine before turning encryption on.',
  ENCRYPTION_KEY_RING_CONFLICT:
    'Another change to the encryption keys landed at the same moment. Reload the page and try again.',
};

/** Names the data in `describeRequestFailure`'s role message, so a 403 points at this section. */
const RESOURCE_LABEL = 'encryption settings';

/** Projects a validated record onto exactly the fields the panel renders. Never key material — the engine does not send it, and this type has no field for it. */
function projectEncryptionKey(record: z.infer<typeof encryptionKeySchema>): EncryptionKey {
  return {
    id: record.id,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    activatedAt: record.activatedAt,
    deletedAt: record.deletedAt,
    active: record.active,
    pendingActivation: record.pendingActivation,
  };
}

function projectEncryptionState(
  record: z.infer<typeof encryptionStateResponseSchema>,
): EncryptionState {
  return {
    enabled: record.enabled,
    keyConfigured: record.keyConfigured,
    keys: record.keys.map(projectEncryptionKey),
    rotation: {
      interval: record.rotation.interval,
      nextRotationAt: record.rotation.nextRotationAt,
    },
    progress: { pending: record.progress.pending, total: record.progress.total },
    reencrypting: record.reencrypting,
  };
}

/** Runs one request and hands back its unvalidated payload, or the error the caller reports. */
async function requestPayload(
  request: () => Promise<AxiosResponse<unknown>>,
  toError: (cause: unknown) => ApiError,
): Promise<unknown> {
  try {
    const response = await request();
    return response.data;
  } catch (cause) {
    throw toError(cause);
  }
}

function findStatus(cause: unknown): number | undefined {
  return isAxiosError(cause) ? cause.response?.status : undefined;
}

function isWriteErrorCode(code: string): code is EncryptionRefusalCode {
  return (ENCRYPTION_WRITE_ERROR_CODES as readonly string[]).includes(code);
}

function describeWriteCode(code: string): string | undefined {
  return isWriteErrorCode(code) ? WRITE_ERROR_MESSAGES[code] : undefined;
}

function toFetchError(cause: unknown): ApiError {
  return toApiError(cause, RESOURCE_LABEL);
}

/** The engine's named refusal is read only from the two statuses it sends one with. */
function toWriteError(cause: unknown): ApiError {
  const status = findStatus(cause);
  const isCoded =
    status === HttpStatusCode.Conflict || status === HttpStatusCode.ServiceUnavailable;
  return toApiError(cause, RESOURCE_LABEL, isCoded ? describeWriteCode : undefined);
}

/**
 * Fetches the whole encryption state in one GET: the target state, whether the engine can act on
 * it, the full key history and the background sweep's progress. Unpaginated — a handful of key
 * rows across the ring's whole lifetime.
 */
export async function fetchEncryptionState(): Promise<EncryptionState> {
  const payload = await requestPayload(
    () => httpClient.get<unknown>(ENCRYPTION_ENDPOINTS.adminEncryption),
    toFetchError,
  );

  const parsedPayload = encryptionStateResponseSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw invalidPayloadError('Response contains malformed encryption settings.');
  }

  return projectEncryptionState(parsedPayload.data);
}

/**
 * Turns encryption on or off. On, the engine creates a key and starts encrypting every stored
 * onboarding in the background; off, it retires the ring and starts decrypting them. Idempotent,
 * and answers with the same shape as the GET so the caller can show the new state at once.
 */
export async function setEncryptionEnabled(enabled: boolean): Promise<EncryptionState> {
  const payload = await requestPayload(
    () => httpClient.patch<unknown>(ENCRYPTION_ENDPOINTS.adminEncryption, { enabled }),
    toWriteError,
  );

  const parsedPayload = encryptionStateResponseSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw invalidPayloadError('Response contains malformed encryption settings.');
  }

  return projectEncryptionState(parsedPayload.data);
}

/**
 * Chooses how often the engine rotates the key on its own, or stops it doing so with `null`. The
 * countdown is the active key's own age, not this request's instant, so an interval shorter than
 * that age has the engine rotate within its next check. Answers with the same shape as the GET.
 */
export async function setEncryptionRotationInterval(
  interval: EncryptionKeyRotationInterval | null,
): Promise<EncryptionState> {
  const payload = await requestPayload(
    () => httpClient.patch<unknown>(ENCRYPTION_ENDPOINTS.adminEncryptionRotation, { interval }),
    toWriteError,
  );

  const parsedPayload = encryptionStateResponseSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw invalidPayloadError('Response contains malformed encryption settings.');
  }

  return projectEncryptionState(parsedPayload.data);
}

/**
 * Rotates the encryption key: the engine generates and wraps a new one and activates it after the
 * grace window. Stored data is not rewritten — rotation is lazy, and a row moves onto the new key
 * the next time it is written. Returns only the new key's id — the client never asks for material,
 * and the engine never sends it.
 */
export async function addEncryptionKey(): Promise<string> {
  const payload = await requestPayload(
    () => httpClient.post<unknown>(ENCRYPTION_ENDPOINTS.adminEncryptionKeys),
    toWriteError,
  );

  const parsedPayload = addEncryptionKeyResponseSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw invalidPayloadError('Response contains a malformed encryption key id.');
  }

  return parsedPayload.data.id;
}

/**
 * Asks the engine to move every stored onboarding onto the active key, including rows still naming
 * a superseded one. Rotation alone does not do this — it is lazy — so this is the response to a
 * data key whose material leaked. The engine records the request and its background sweep does the
 * work; no row is ever stored as plain JSON on the way. Answers with the state, as `GET` would.
 */
export async function requestReencryption(): Promise<EncryptionState> {
  const payload = await requestPayload(
    () => httpClient.post<unknown>(ENCRYPTION_ENDPOINTS.adminEncryptionReencryption),
    toWriteError,
  );

  const parsedPayload = encryptionStateResponseSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw invalidPayloadError('Response contains a malformed encryption state.');
  }

  return projectEncryptionState(parsedPayload.data);
}
