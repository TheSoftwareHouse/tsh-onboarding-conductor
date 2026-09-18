import { isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/services/api/describe-request-failure';
import { httpClient } from '@/services/api/http-client';
import { ENCRYPTION_KEY_ENDPOINTS } from '../constants/endpoints';
import type { EncryptionKey, ReEncryptionProgress } from '../types/encryption-key';

const encryptionKeySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  activatedAt: z.string(),
  deletedAt: z.string().nullable(),
  active: z.boolean(),
});

const reEncryptionProgressSchema = z.object({
  pending: z.number().int().min(0),
  total: z.number().int().min(0),
});

const listEncryptionKeysResponseSchema = z.object({
  keys: z.array(encryptionKeySchema),
  reEncryption: reEncryptionProgressSchema,
});

const addEncryptionKeyResponseSchema = z.object({
  id: z.string(),
});

/** The one error body the engine sends alongside a refused rotation; any other 4xx/5xx body is ignored. */
const encryptionDisabledBodySchema = z.object({
  code: z.literal('ENCRYPTION_DISABLED'),
});

export type EncryptionKeysFetchErrorReason = 'request-failed' | 'invalid-payload';

export class EncryptionKeysFetchError extends Error {
  readonly reason: EncryptionKeysFetchErrorReason;
  readonly status?: number;

  constructor(reason: EncryptionKeysFetchErrorReason, message: string, status?: number) {
    super(message);
    this.name = 'EncryptionKeysFetchError';
    this.reason = reason;
    this.status = status;
  }
}

export class AddEncryptionKeyError extends Error {
  readonly status?: number;
  /** True only for 409 `ENCRYPTION_DISABLED` — the one failure the panel explains differently. */
  readonly disabled: boolean;

  constructor(message: string, status?: number, disabled = false) {
    super(message);
    this.name = 'AddEncryptionKeyError';
    this.status = status;
    this.disabled = disabled;
  }
}

export interface EncryptionKeysList {
  keys: EncryptionKey[];
  reEncryption: ReEncryptionProgress;
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
  };
}

/** Whether a rejected rotation is the one the panel gives operator-facing copy for: encryption is off. */
function isEncryptionDisabled(cause: unknown): boolean {
  if (!isAxiosError(cause) || cause.response?.status !== 409) {
    return false;
  }

  return encryptionDisabledBodySchema.safeParse(cause.response.data).success;
}

/**
 * Fetches the full key history and the derived re-encryption progress. The endpoint is
 * unpaginated — a table with a handful of rows across the key's whole lifetime — so this issues
 * one GET request, validates the payload against the Zod schema, and returns the projected list.
 */
export async function fetchEncryptionKeys(): Promise<EncryptionKeysList> {
  let response;
  try {
    response = await httpClient.get<unknown>(ENCRYPTION_KEY_ENDPOINTS.adminEncryptionKeys);
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    throw new EncryptionKeysFetchError(
      'request-failed',
      describeRequestFailure(status, cause, 'encryption keys'),
      status,
    );
  }

  const parsedPayload = listEncryptionKeysResponseSchema.safeParse(response.data);
  if (!parsedPayload.success) {
    throw new EncryptionKeysFetchError(
      'invalid-payload',
      'Response contains a malformed encryption key.',
    );
  }

  return {
    keys: parsedPayload.data.keys.map(projectEncryptionKey),
    reEncryption: parsedPayload.data.reEncryption,
  };
}

/**
 * Rotates the encryption key: the engine generates and wraps a new one, soft-deletes the
 * previously active key in the same transaction, and starts re-encrypting existing data onto it
 * in the background. Returns only the new key's id — the client never asks for material, and the
 * engine never sends it.
 */
export async function addEncryptionKey(): Promise<string> {
  let response;
  try {
    response = await httpClient.post<unknown>(ENCRYPTION_KEY_ENDPOINTS.adminEncryptionKeys);
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    const disabled = isEncryptionDisabled(cause);
    throw new AddEncryptionKeyError(
      disabled
        ? 'Encryption is not enabled, so there is no key to rotate.'
        : describeRequestFailure(status, cause, 'encryption keys'),
      status,
      disabled,
    );
  }

  const parsedPayload = addEncryptionKeyResponseSchema.safeParse(response.data);
  if (!parsedPayload.success) {
    throw new AddEncryptionKeyError('Response contains a malformed encryption key id.');
  }

  return parsedPayload.data.id;
}
