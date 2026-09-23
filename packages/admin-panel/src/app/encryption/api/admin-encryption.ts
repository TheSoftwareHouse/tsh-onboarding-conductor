import { HttpStatusCode, isAxiosError, type AxiosResponse } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/services/api/describe-request-failure';
import { httpClient } from '@/services/api/http-client';
import { ENCRYPTION_ENDPOINTS } from '../constants/endpoints';
import { ROTATION_INTERVALS } from '../constants/rotation-intervals';
import type {
  EncryptionKey,
  EncryptionKeyRotationInterval,
  EncryptionState,
} from '../types/encryption';

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
export type EncryptionWriteErrorCode = (typeof ENCRYPTION_WRITE_ERROR_CODES)[number];

const writeErrorBodySchema = z.object({
  code: z.enum(ENCRYPTION_WRITE_ERROR_CODES),
});

const WRITE_ERROR_MESSAGES: Record<EncryptionWriteErrorCode, string> = {
  ENCRYPTION_DISABLED: 'Encryption is turned off, so there is no key to rotate.',
  ENCRYPTION_KEY_NOT_CONFIGURED:
    'The engine has no ENCRYPTION_KEY configured. Set it and restart the engine before turning encryption on.',
  ENCRYPTION_KEY_RING_CONFLICT:
    'Another change to the encryption keys landed at the same moment. Reload the page and try again.',
};

/** Names the data in `describeRequestFailure`'s role message, so a 403 points at this section. */
const RESOURCE_LABEL = 'encryption settings';

export type EncryptionFetchErrorReason = 'request-failed' | 'invalid-payload';

export class EncryptionFetchError extends Error {
  readonly reason: EncryptionFetchErrorReason;
  readonly status?: number;

  constructor(reason: EncryptionFetchErrorReason, message: string, status?: number) {
    super(message);
    this.name = 'EncryptionFetchError';
    this.reason = reason;
    this.status = status;
  }
}

export class EncryptionWriteError extends Error {
  readonly status?: number;
  /** The engine's named refusal, or `null` for any failure it did not name — auth, network, 5xx. */
  readonly code: EncryptionWriteErrorCode | null;

  constructor(message: string, status?: number, code: EncryptionWriteErrorCode | null = null) {
    super(message);
    this.name = 'EncryptionWriteError';
    this.status = status;
    this.code = code;
  }
}

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
  toError: (cause: unknown) => Error,
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

function toFetchError(cause: unknown): EncryptionFetchError {
  const status = findStatus(cause);
  return new EncryptionFetchError(
    'request-failed',
    describeRequestFailure(status, cause, RESOURCE_LABEL),
    status,
  );
}

/** The engine's named refusal, read only from the two statuses it sends one with. */
function findWriteErrorCode(cause: unknown): EncryptionWriteErrorCode | null {
  const status = findStatus(cause);
  if (
    !isAxiosError(cause) ||
    (status !== HttpStatusCode.Conflict && status !== HttpStatusCode.ServiceUnavailable)
  ) {
    return null;
  }

  const parsedBody = writeErrorBodySchema.safeParse(cause.response?.data);
  return parsedBody.success ? parsedBody.data.code : null;
}

function toWriteError(cause: unknown): EncryptionWriteError {
  const status = findStatus(cause);
  const code = findWriteErrorCode(cause);
  const message =
    code === null
      ? describeRequestFailure(status, cause, RESOURCE_LABEL)
      : WRITE_ERROR_MESSAGES[code];

  return new EncryptionWriteError(message, status, code);
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
    throw new EncryptionFetchError(
      'invalid-payload',
      'Response contains malformed encryption settings.',
    );
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
    throw new EncryptionWriteError('Response contains malformed encryption settings.');
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
    throw new EncryptionWriteError('Response contains malformed encryption settings.');
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
    throw new EncryptionWriteError('Response contains a malformed encryption key id.');
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
    throw new EncryptionWriteError('Response contains a malformed encryption state.');
  }

  return projectEncryptionState(parsedPayload.data);
}
