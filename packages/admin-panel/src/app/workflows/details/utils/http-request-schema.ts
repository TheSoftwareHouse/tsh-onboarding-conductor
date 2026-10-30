import { STEP_TYPE } from '@tsh/ddl-schema/step-types';
import { JSON_VALUE_REF, toRef, type Schema } from './config-schema';
import { isPlainObject } from './is-plain-object';

// Restates packages/engine/src/connectors/adapters/built-in/http-request/http-request-config.ts.
export const HTTP_REQUEST_METHOD = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
} as const;

export const HTTP_REQUEST_METHODS = Object.values(HTTP_REQUEST_METHOD);

const TIMEOUT_MS_MIN = 100;
const TIMEOUT_MS_MAX = 30000;
const ERROR_STATUS_MIN = 400;
const ERROR_STATUS_MAX = 499;

const JSON_VALUE: Schema = { $ref: toRef(JSON_VALUE_REF) };

const STRING_MAP: Schema = {
  type: 'object',
  additionalProperties: { type: 'string' },
};

/** A body that is not a plain object keeps the free-form JSON editor, so nothing stored is lost. */
function buildBodySchema(body: unknown): Schema {
  if (body !== undefined && !isPlainObject(body)) {
    return JSON_VALUE;
  }
  return { type: 'object', additionalProperties: JSON_VALUE };
}

export function buildHttpRequestSchema(request: unknown): Schema {
  return {
    type: 'object',
    required: ['method', 'url'],
    properties: {
      method: { enum: HTTP_REQUEST_METHODS },
      url: { type: 'string' },
      headers: STRING_MAP,
      query: STRING_MAP,
      body: buildBodySchema(isPlainObject(request) ? request.body : undefined),
      timeoutMs: { type: 'integer', minimum: TIMEOUT_MS_MIN, maximum: TIMEOUT_MS_MAX },
    },
  };
}

export const HTTP_RESPONSE_SCHEMA: Schema = {
  type: 'object',
  properties: {
    errorsPath: { type: 'string' },
    errorStatuses: {
      type: 'array',
      items: { type: 'integer', minimum: ERROR_STATUS_MIN, maximum: ERROR_STATUS_MAX },
    },
  },
};

/** An `http-call` config schema with its untyped `request` and `response` replaced by the panel's own. */
export function withHttpRequestSchema(
  type: string,
  schema: Schema,
  config: Record<string, unknown>,
): Schema {
  if (type !== STEP_TYPE.httpCall || schema.properties === undefined) return schema;
  return {
    ...schema,
    properties: {
      ...schema.properties,
      request: buildHttpRequestSchema(config.request),
      response: HTTP_RESPONSE_SCHEMA,
    },
  };
}
