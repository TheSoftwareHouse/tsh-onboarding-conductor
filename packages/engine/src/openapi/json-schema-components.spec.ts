import type { OpenAPIObject } from '@nestjs/swagger';
import { getNodeGraphJsonSchema, getWorkflowJsonSchema } from '@tsh/ddl-schema';
import { embedJsonSchemaDocument } from './json-schema-components';

function emptyDocument(): OpenAPIObject {
  return { openapi: '3.1.0', info: { title: 't', version: '0' }, paths: {} };
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

describe('embedJsonSchemaDocument', () => {
  it('mounts the root and its definitions as components and rewrites local refs', () => {
    const document = emptyDocument();

    embedJsonSchemaDocument(document, 'Doc', {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'doc',
      type: 'object',
      properties: {
        one: { $ref: '#/definitions/thing' },
        many: { type: 'array', items: { $ref: '#/definitions/thing' } },
      },
      definitions: {
        thing: { type: 'object', properties: { self: { $ref: '#/definitions/thing' } } },
      },
    });

    expect(document.components?.schemas).toEqual({
      Doc: {
        type: 'object',
        properties: {
          one: { $ref: '#/components/schemas/Doc_thing' },
          many: { type: 'array', items: { $ref: '#/components/schemas/Doc_thing' } },
        },
      },
      Doc_thing: {
        type: 'object',
        properties: { self: { $ref: '#/components/schemas/Doc_thing' } },
      },
    });
  });

  it.each([
    ['workflow', getWorkflowJsonSchema],
    ['node graph', getNodeGraphJsonSchema],
  ])('embeds the real %s schema with every reference resolvable', (_, schemaOf) => {
    const document = emptyDocument();

    embedJsonSchemaDocument(document, 'Doc', schemaOf());

    const schemas = document.components?.schemas ?? {};
    const refs = collectRefs(schemas);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('#/components/schemas/')).toBe(true);
      expect(schemas).toHaveProperty(ref.slice('#/components/schemas/'.length));
    }
    expect(JSON.stringify(schemas)).not.toContain('#/definitions/');
    expect(schemas.Doc).not.toHaveProperty('$schema');
    expect(schemas.Doc).not.toHaveProperty('definitions');
  });
});
