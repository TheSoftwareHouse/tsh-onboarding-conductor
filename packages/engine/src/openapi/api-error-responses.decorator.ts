import { applyDecorators, HttpException, HttpStatus, type Type } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type {
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { API_ERROR_SCHEMA, NEST_HTTP_ERROR_SCHEMA, schemaRef } from './openapi.constants';

/**
 * A client-facing exception class (engine `CLAUDE.md`, "Error contracts"). `apiDescription` is the
 * one line the documentation prints beside its code: what the refusal means and which detail
 * properties, if any, the payload adds.
 */
export type ApiErrorClass = Type<HttpException> & { readonly apiDescription?: string };

/**
 * One documented failure. A bare class is described by constructing it with no arguments. The
 * object form passes the arguments a class needs when its status depends on them, and may replace
 * the class's own description for that case.
 */
export type ApiErrorSource =
  | ApiErrorClass
  | Readonly<{ exception: ApiErrorClass; args: readonly unknown[]; description?: string }>;

/**
 * A refusal the framework answers with its own envelope before the handler runs: a DTO the global
 * `ValidationPipe` rejects, a route pipe refusing a parameter, or the admin bearer guard.
 */
export type FrameworkErrorSource = Readonly<{
  framework: true;
  status: number;
  description: string;
}>;

export type ApiErrorDescription = Readonly<{
  status: number;
  code: string;
  description: string | undefined;
}>;

export const VALIDATION_ERROR: FrameworkErrorSource = {
  framework: true,
  status: HttpStatus.BAD_REQUEST,
  description: 'The body or query violates its declared shape; `message` names each violated rule.',
};

export function frameworkError(status: number, description: string): FrameworkErrorSource {
  return { framework: true, status, description };
}

/**
 * Reads a documented error off the class that raises it. The class is constructed and asked rather
 * than annotated a second time: every client-facing exception already owns its `{ code, message }`
 * and extends the Nest subclass that carries its status, so the instance is the one source that
 * cannot disagree with what the route really returns.
 */
export function describeApiError(source: ApiErrorSource): ApiErrorDescription {
  const [exception, args, description] =
    typeof source === 'function'
      ? [source, [], source.apiDescription]
      : [source.exception, source.args, source.description ?? source.exception.apiDescription];
  const instance = new exception(...args);
  const response = instance.getResponse();
  const code =
    typeof response === 'object' && response !== null ? Reflect.get(response, 'code') : undefined;

  if (typeof code !== 'string') {
    throw new TypeError(
      `${exception.name} carries no { code } payload and cannot be documented as an API error`,
    );
  }

  return { status: instance.getStatus(), code, description };
}

type StatusGroup = { codes: ApiErrorDescription[]; framework?: string };

/**
 * Declares every failure a handler can answer with, grouped into one response per status. A status
 * that both the framework and the handler can produce is documented as either envelope, since a
 * client cannot tell from the status alone which one it received.
 */
export function ApiErrorResponses(
  ...sources: readonly (ApiErrorSource | FrameworkErrorSource)[]
): MethodDecorator {
  const groups = new Map<number, StatusGroup>();
  const groupFor = (status: number): StatusGroup => {
    const existing = groups.get(status);

    if (existing) {
      return existing;
    }

    const created: StatusGroup = { codes: [] };
    groups.set(status, created);

    return created;
  };

  for (const source of sources) {
    if (isFrameworkError(source)) {
      groupFor(source.status).framework = source.description;
      continue;
    }

    const error = describeApiError(source);
    const group = groupFor(error.status);

    if (!group.codes.some((known) => known.code === error.code)) {
      group.codes.push(error);
    }
  }

  const responses = [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([status, group]) =>
      ApiResponse({ status, description: describeGroup(group), schema: schemaFor(group) }),
    );

  return applyDecorators(...responses);
}

function isFrameworkError(
  source: ApiErrorSource | FrameworkErrorSource,
): source is FrameworkErrorSource {
  return typeof source === 'object' && 'framework' in source;
}

function describeGroup(group: StatusGroup): string {
  const lines = group.codes.map(({ code, description }) =>
    description === undefined ? `\`${code}\`` : `\`${code}\`: ${description}`,
  );

  if (group.framework !== undefined) {
    lines.unshift(group.framework);
  }

  return lines.join('\n\n');
}

type ResponseSchema = SchemaObject & Partial<ReferenceObject>;

function schemaFor(group: StatusGroup): ResponseSchema {
  const framework: ResponseSchema = { $ref: schemaRef(NEST_HTTP_ERROR_SCHEMA) };
  const coded: SchemaObject = {
    allOf: [
      { $ref: schemaRef(API_ERROR_SCHEMA) },
      {
        type: 'object',
        properties: {
          code: { type: 'string', enum: group.codes.map((error) => error.code) },
        },
      },
    ],
  };

  if (group.codes.length === 0) {
    return framework;
  }

  return group.framework === undefined ? coded : { oneOf: [framework, coded] };
}
