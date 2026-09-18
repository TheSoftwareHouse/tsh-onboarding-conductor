import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenAPIObject } from '@nestjs/swagger';
import type {
  OperationObject,
  PathItemObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { buildOpenApiDocument } from './openapi-document';
import {
  ADMIN_BEARER_AUTH,
  API_TAGS,
  COMPILED_WORKFLOW_DOCUMENT_SCHEMA,
  WORKFLOW_DOCUMENT_SCHEMA,
} from './openapi.constants';
import { createOpenApiApp } from './testing/create-openapi-app';
import { ENGINE_OPENAPI_DOCUMENT_FILE, renderOpenApiDocument } from './testing/openapi-artifact';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'] as const;

type Operation = { path: string; method: string; operation: OperationObject };

function listOperations(document: OpenAPIObject): Operation[] {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = (item as PathItemObject)[method];

      return operation ? [{ path, method, operation }] : [];
    }),
  );
}

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRefs(item, refs));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') {
        refs.push(child);
      } else {
        collectRefs(child, refs);
      }
    }
  }

  return refs;
}

type SchemaNode = Record<string, unknown>;

/** Every schema that describes a value a client reads or sends, as `<component>.<path>`. */
function listPropertySchemas(schemas: Record<string, unknown>): [string, SchemaNode][] {
  const found: [string, SchemaNode][] = [];
  const visit = (node: unknown, at: string): void => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      return;
    }

    const schema = node as SchemaNode;
    found.push([at, schema]);

    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      visit(child, `${at}.${name}`);
    }
    visit(schema.items, `${at}[]`);
    if (typeof schema.additionalProperties === 'object') {
      visit(schema.additionalProperties, `${at}[*]`);
    }
    for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
      ((schema[keyword] as unknown[] | undefined) ?? []).forEach((child, index) =>
        visit(child, `${at}.${keyword}[${index}]`),
      );
    }
  };

  for (const [name, schema] of Object.entries(schemas)) {
    visit(schema, name);
  }

  return found;
}

const SAYS_WHAT_IT_IS = ['type', '$ref', 'allOf', 'oneOf', 'anyOf', 'enum', 'description'];

describe('OpenAPI document', () => {
  let document: OpenAPIObject;
  let operations: Operation[];

  beforeAll(async () => {
    document = buildOpenApiDocument(await createOpenApiApp());
    operations = listOperations(document);
  });

  it('equals the committed engine.openapi.json (run `pnpm openapi:generate` after changing a route, a DTO or an error contract)', () => {
    const committed: unknown = JSON.parse(readFileSync(ENGINE_OPENAPI_DOCUMENT_FILE, 'utf8'));

    expect(JSON.parse(renderOpenApiDocument(document))).toEqual(committed);
  });

  it('is OpenAPI 3.1, versioned as the engine package', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));

    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe(manifest.version);
  });

  it('spells nullability the 3.1 way throughout', () => {
    expect(JSON.stringify(document)).not.toContain('"nullable"');
  });

  it('covers every controller route', () => {
    expect(operations.map(({ method, path }) => `${method.toUpperCase()} ${path}`).sort()).toEqual(
      [
        'DELETE /v1/admin/connectors/{connectorId}',
        'GET /v1/admin/agreements',
        'GET /v1/admin/audit',
        'GET /v1/admin/connectors',
        'GET /v1/admin/connectors/{connectorId}',
        'GET /v1/admin/encryption/keys',
        'GET /v1/admin/step-types',
        'GET /v1/admin/step-types/schema',
        'GET /v1/admin/workflows/{workflowId}',
        'GET /v1/health/live',
        'GET /v1/onboardings',
        'GET /v1/onboardings/{id}',
        'GET /v1/onboardings/{id}/agreements',
        'GET /v1/onboardings/{id}/state',
        'GET /v1/onboardings/{id}/transitions',
        'PATCH /v1/admin/connectors/{connectorId}',
        'POST /v1/admin/agreements',
        'POST /v1/admin/encryption/keys',
        'POST /v1/admin/workflows/compile',
        'POST /v1/onboardings',
        'POST /v1/onboardings/{id}/agreements',
        'POST /v1/onboardings/{id}/agreements/{agreementId}/accept',
        'POST /v1/onboardings/{id}/documents',
        'POST /v1/onboardings/{id}/documents/{documentId}/complete',
        'POST /v1/onboardings/{id}/review/{action}',
        'POST /v1/onboardings/{id}/submit',
        'POST /v1/webhooks/{providerKey}/callback',
        'PUT /v1/admin/connectors/{connectorId}',
      ].sort(),
    );
  });

  it('gives every operation a unique id, a summary and a declared tag', () => {
    const tagNames: string[] = Object.values(API_TAGS).map((tag) => tag.name);
    const ids = operations.map(({ operation }) => operation.operationId);

    expect(new Set(ids).size).toBe(ids.length);
    for (const { method, path, operation } of operations) {
      const where = `${method.toUpperCase()} ${path}`;

      expect([where, operation.operationId]).toEqual([
        where,
        expect.stringMatching(/^[a-z][A-Za-z]+$/),
      ]);
      expect([where, operation.summary]).toEqual([where, expect.stringMatching(/\S/)]);
      expect([where, operation.tags?.length, tagNames.includes(operation.tags?.[0] ?? '')]).toEqual(
        [where, 1, true],
      );
    }
  });

  it('describes one success response per operation, with a body schema unless it is a 204', () => {
    for (const { method, path, operation } of operations) {
      const where = `${method.toUpperCase()} ${path}`;
      const successes = Object.entries(operation.responses).filter(([status]) =>
        status.startsWith('2'),
      );

      expect([where, successes.length]).toEqual([where, 1]);
      for (const [status, response] of successes) {
        const { content: body, description } = response as {
          content?: Record<string, { schema?: unknown }>;
          description?: string;
        };

        expect([where, description]).toEqual([where, expect.stringMatching(/\S/)]);

        if (status === '204') {
          expect([where, body]).toEqual([where, undefined]);
        } else {
          expect([where, body?.['application/json']?.schema]).toEqual([where, expect.anything()]);
        }
      }
    }
  });

  it('declares every path parameter', () => {
    for (const { method, path, operation } of operations) {
      const where = `${method.toUpperCase()} ${path}`;
      const declared = (operation.parameters ?? [])
        .filter((parameter) => 'in' in parameter && parameter.in === 'path')
        .map((parameter) => ('name' in parameter ? parameter.name : ''))
        .sort();
      const inPath = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();

      expect([where, declared]).toEqual([where, inPath]);
    }
  });

  it('requires the bearer token on every admin operation and on nothing else', () => {
    for (const { method, path, operation } of operations) {
      const where = `${method.toUpperCase()} ${path}`;
      const admin = (operation.tags ?? []).some((tag) => tag.startsWith('Admin:'));

      expect([where, operation.security ?? []]).toEqual([
        where,
        admin ? [{ [ADMIN_BEARER_AUTH]: [] }] : [],
      ]);
    }
  });

  it('resolves every reference', () => {
    const schemas = document.components?.schemas ?? {};

    for (const ref of collectRefs(document)) {
      expect(ref).toMatch(/^#\/components\/schemas\//);
      expect([ref, ref.slice('#/components/schemas/'.length) in schemas]).toEqual([ref, true]);
    }
  });

  it('says what every property is, or describes it deliberately', () => {
    const schemas = Object.fromEntries(
      Object.entries(document.components?.schemas ?? {}).filter(
        ([name]) =>
          !name.startsWith(WORKFLOW_DOCUMENT_SCHEMA) &&
          !name.startsWith(COMPILED_WORKFLOW_DOCUMENT_SCHEMA),
      ),
    );

    for (const [at, schema] of listPropertySchemas(schemas)) {
      expect([at, SAYS_WHAT_IT_IS.some((keyword) => keyword in schema)]).toEqual([at, true]);
    }
  });

  it('embeds the workflow document schemas the compile route accepts', () => {
    const schemas = document.components?.schemas ?? {};

    expect(schemas).toHaveProperty(WORKFLOW_DOCUMENT_SCHEMA);
    expect(schemas).toHaveProperty(COMPILED_WORKFLOW_DOCUMENT_SCHEMA);
  });
});
