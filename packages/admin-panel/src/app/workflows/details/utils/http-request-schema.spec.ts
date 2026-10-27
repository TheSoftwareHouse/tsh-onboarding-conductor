import { findStepType, STEP_TYPE } from '@tsh/ddl-schema/step-types';
import { describe, expect, it } from 'vitest';
import type { Schema } from './config-schema';
import {
  buildHttpRequestSchema,
  HTTP_REQUEST_METHODS,
  HTTP_RESPONSE_SCHEMA,
  withHttpRequestSchema,
} from './http-request-schema';

const httpCallSchema = (): Schema =>
  findStepType(STEP_TYPE.httpCall)?.buildConfigSchema() as Schema;

describe('buildHttpRequestSchema', () => {
  it('requires method and url, with the engine method list and timeout bounds', () => {
    const schema = buildHttpRequestSchema({ method: 'POST', url: 'https://x' });

    expect(schema.required).toEqual(['method', 'url']);
    expect(schema.properties?.method).toEqual({ enum: HTTP_REQUEST_METHODS });
    expect(schema.properties?.timeoutMs).toMatchObject({ minimum: 100, maximum: 30000 });
  });

  it('types headers and query as string maps', () => {
    const schema = buildHttpRequestSchema({});

    for (const key of ['headers', 'query']) {
      expect(schema.properties?.[key]).toEqual({
        type: 'object',
        additionalProperties: { type: 'string' },
      });
    }
  });

  it.each([undefined, { name: 'x' }])('types a body of %j as a map of JSON values', (body) => {
    expect(buildHttpRequestSchema({ body }).properties?.body).toEqual({
      type: 'object',
      additionalProperties: { $ref: '#/definitions/jsonValue' },
    });
  });

  it.each([[[1, 2]], ['text'], [3], [null]])('keeps a body of %j as one JSON value', (body) => {
    expect(buildHttpRequestSchema({ body }).properties?.body).toEqual({
      $ref: '#/definitions/jsonValue',
    });
  });
});

describe('withHttpRequestSchema', () => {
  it('replaces request and response on an http-call step only', () => {
    const schema = withHttpRequestSchema(STEP_TYPE.httpCall, httpCallSchema(), { request: {} });

    expect(schema.properties?.request?.required).toEqual(['method', 'url']);
    expect(schema.properties?.response).toBe(HTTP_RESPONSE_SCHEMA);
    expect(schema.properties?.connector).toEqual(httpCallSchema().properties?.connector);
  });

  it('leaves any other step type unchanged', () => {
    const schema = httpCallSchema();

    expect(withHttpRequestSchema(STEP_TYPE.form, schema, {})).toBe(schema);
  });
});
