import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { getCompiledWorkflowJsonSchema, getWorkflowJsonSchema } from '@tsh/ddl-schema';
import { API_ENUMS } from './api-enums';
import { embedJsonSchemaDocument } from './json-schema-components';
import { toOpenApi31Dialect } from './openapi-dialect';
import {
  ADMIN_BEARER_AUTH,
  API_ERROR_SCHEMA,
  API_TAGS,
  JSON_VALUE_SCHEMA,
  NEST_HTTP_ERROR_SCHEMA,
  COMPILED_WORKFLOW_DOCUMENT_SCHEMA,
  OPENAPI_DOCUMENT_PATH,
  WORKFLOW_CONDITION_SCHEMA,
  WORKFLOW_DOCUMENT_SCHEMA,
} from './openapi.constants';

/**
 * 3.1 rather than 3.0 because the authored and compiled workflow schemas are embedded as they are:
 * they use `if`/`then`, `const` and local `$ref`s, which 3.0's schema subset does not carry.
 */
const OPENAPI_VERSION = '3.1.0';

const DESCRIPTION = `
The HTTP surface of the onboarding engine: the service that loads workflow definitions, runs
onboardings against them and drives connectors, provider callbacks and client webhooks.

## Audiences

- **Onboarding flow.** The end customer's own onboarding. Unauthenticated: the onboarding id is
  the only handle, so treat it as a capability.
- **Admin.** The operator surface the admin panel is built on. Every operation requires a bearer
  access token (see *Authentication*).
- **Provider callbacks.** Where a connector's provider posts an asynchronous result, authenticated
  by the HMAC recipe the connector adapter declares.

## Authentication

Admin operations carry the \`${ADMIN_BEARER_AUTH}\` security requirement: a Microsoft Entra ID
access token for the engine's API app registration whose \`roles\` claim holds at least one of the
configured operator roles. A missing or unverifiable token is answered with \`401\`, a verified token
without an operator role with \`403\`, and \`503\` says the token could not be judged because Entra's
signing keys were unreachable. Every decision, granted or refused, is written to the audit log.

## Errors

The engine answers a refusal it owns with \`{ "code", "message" }\`: \`code\` is the stable
identifier a client should branch on, and each operation lists the codes it can return. Some codes
add detail properties; the operation's response description names them. Where the framework refuses
a request before the handler runs, the body is NestJS's own \`{ "statusCode", "message", "error" }\`
envelope: request validation (\`400\`) and the admin bearer guard (\`401\`, \`403\`, \`503\`).

## Bodies the workflow decides

Two request bodies have no fixed shape. A submit body follows the current step: read
\`GET /v1/onboardings/{id}/state\` and its \`step.schema\` says exactly what the engine will accept.
A connector's settings body is a map whose keys the connector adapter declares; the read side lists
them. The compile body is a workflow document, and its schema is embedded here in full.

## About this document

Generated from the engine's own route and DTO decorators, and committed beside the code; a test
fails when the two disagree. A running engine serves it at \`GET ${OPENAPI_DOCUMENT_PATH}\`.
`.trim();

const API_ERROR: SchemaObject = {
  type: 'object',
  description:
    "The engine's own error envelope. `code` is the stable identifier a client branches on; " +
    '`message` repeats it. A code that adds detail properties is described on the operation that ' +
    'returns it.',
  required: ['code', 'message'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
  },
  additionalProperties: true,
};

const NEST_HTTP_ERROR: SchemaObject = {
  type: 'object',
  description:
    "NestJS's default error envelope, returned where the framework refuses a request before the " +
    'handler runs: request validation (`400`, `message` lists each violated rule) and the admin ' +
    'bearer guard (`401`, `403`, `503`).',
  required: ['statusCode', 'message'],
  properties: {
    statusCode: { type: 'integer' },
    message: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    error: { type: 'string' },
  },
};

const JSON_VALUE: SchemaObject = {
  description: 'Any JSON value: an object, an array, a string, a number, a boolean or null.',
};

const CONDITION_REF = { $ref: `#/components/schemas/${WORKFLOW_CONDITION_SCHEMA}` };
const CONDITION_SCALAR: SchemaObject = {
  oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
};

/**
 * The normalized condition, written out by hand: the DDL package validates the raw form with its
 * schema but normalizes into this shape in code, so no derived schema exists to embed.
 */
const WORKFLOW_CONDITION: SchemaObject = {
  description:
    'A condition in normalized form: a combinator over other conditions, a comparison of a score, ' +
    'or a test of a submitted field.',
  oneOf: [
    {
      type: 'object',
      required: ['all'],
      properties: { all: { type: 'array', items: CONDITION_REF } },
    },
    {
      type: 'object',
      required: ['any'],
      properties: { any: { type: 'array', items: CONDITION_REF } },
    },
    { type: 'object', required: ['not'], properties: { not: CONDITION_REF } },
    {
      type: 'object',
      required: ['score', 'gte'],
      properties: { score: { type: 'string' }, gte: { type: 'number' } },
    },
    {
      type: 'object',
      required: ['score', 'gt'],
      properties: { score: { type: 'string' }, gt: { type: 'number' } },
    },
    {
      type: 'object',
      required: ['score', 'lte'],
      properties: { score: { type: 'string' }, lte: { type: 'number' } },
    },
    {
      type: 'object',
      required: ['score', 'lt'],
      properties: { score: { type: 'string' }, lt: { type: 'number' } },
    },
    {
      type: 'object',
      required: ['field', 'equals'],
      properties: { field: { type: 'string' }, equals: CONDITION_SCALAR },
    },
    {
      type: 'object',
      required: ['field', 'in'],
      properties: { field: { type: 'string' }, in: { type: 'array', items: CONDITION_SCALAR } },
    },
    {
      type: 'object',
      required: ['field', 'isSet'],
      properties: { field: { type: 'string' }, isSet: { type: 'boolean' } },
    },
  ],
};

/**
 * Builds the document from the application's route and DTO metadata, then adds what decorators
 * cannot say: the two error envelopes, the workflow schemas the DDL package derives in memory, and
 * the 3.1 spelling of nullable properties. The result is what the engine serves and what the
 * committed `engine.openapi.json` must equal.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setOpenAPIVersion(OPENAPI_VERSION)
    .setTitle('TSH Onboarding Conductor Engine API')
    .setDescription(DESCRIPTION)
    .setVersion(readEngineVersion())
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'A Microsoft Entra ID access token issued for the engine API app registration ' +
          '(`AZURE_API_AUDIENCE`), carrying at least one of the roles in `ADMIN_REQUIRED_ROLES`. ' +
          'With `ADMIN_AUTH_ENABLED=false`, a local-only setting the engine refuses in production, ' +
          'the guard is skipped and no token is needed.',
      },
      ADMIN_BEARER_AUTH,
    );

  for (const tag of Object.values(API_TAGS)) {
    builder.addTag(tag.name, tag.description);
  }

  // Tags are declared explicitly per route or controller; the scanner's controller-name tags would
  // otherwise add an "Onboardings" group beside the audience-based ones.
  const document = SwaggerModule.createDocument(app, builder.build(), {
    autoTagControllers: false,
  });
  const components = (document.components ??= {});
  const schemas = (components.schemas ??= {});

  schemas[API_ERROR_SCHEMA] = API_ERROR;
  schemas[NEST_HTTP_ERROR_SCHEMA] = NEST_HTTP_ERROR;
  schemas[JSON_VALUE_SCHEMA] = JSON_VALUE;
  for (const apiEnum of API_ENUMS) {
    schemas[apiEnum.enumName] = {
      type: 'string',
      enum: apiEnum.enum,
      description: apiEnum.description,
    };
  }
  schemas[WORKFLOW_CONDITION_SCHEMA] = WORKFLOW_CONDITION;
  embedJsonSchemaDocument(document, WORKFLOW_DOCUMENT_SCHEMA, getWorkflowJsonSchema());
  embedJsonSchemaDocument(
    document,
    COMPILED_WORKFLOW_DOCUMENT_SCHEMA,
    getCompiledWorkflowJsonSchema(),
  );

  return toOpenApi31Dialect(document);
}

/**
 * Serves the JSON at `OPENAPI_DOCUMENT_PATH` and nothing else: no Swagger UI, so the image carries
 * no extra page and the reader-facing documentation site stays the one place the API is browsed.
 */
export function serveOpenApiDocument(app: INestApplication, document: OpenAPIObject): void {
  SwaggerModule.setup('v1/openapi', app, document, {
    ui: false,
    raw: ['json'],
    jsonDocumentUrl: OPENAPI_DOCUMENT_PATH,
  });
}

/**
 * `src/openapi` and `dist/openapi` sit at the same depth below the package root, so one relative
 * path serves ts-node, jest and the built image alike. Read rather than imported: the package
 * manifest lives outside `rootDir`, and the version must be the one the engine ships as.
 */
function readEngineVersion(): string {
  const manifest = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
  ) as { version: string };

  return manifest.version;
}
