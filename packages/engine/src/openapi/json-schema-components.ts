import type { OpenAPIObject } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import type { JsonSchemaFragment } from '@tsh/ddl-schema';

const LOCAL_DEFINITION_REF = '#/definitions/';

/**
 * Mounts a self-contained JSON Schema document, one that carries its own `definitions`, as a named
 * component of the OpenAPI document.
 *
 * The DDL package derives the authored and compiled workflow schemas in memory, so embedding them
 * is what lets the document state exactly what the compile endpoint accepts rather than "an object".
 * The root becomes `components.schemas[name]`; each definition becomes `<name>_<definition>` beside
 * it, and every local `$ref` is rewritten to match. `$schema` and `$id` are dropped: OpenAPI 3.1
 * speaks JSON Schema 2020-12 document-wide, and the keywords these schemas use mean the same thing
 * in both dialects.
 */
export function embedJsonSchemaDocument(
  document: OpenAPIObject,
  name: string,
  schema: JsonSchemaFragment,
): void {
  const { $schema, $id, definitions, ...root } = schema as JsonSchemaFragment & {
    definitions?: Record<string, JsonSchemaFragment>;
  };
  void $schema;
  void $id;

  const rename = (definition: string): string => `${name}_${definition}`;
  const components = (document.components ??= {});
  const schemas = (components.schemas ??= {});

  schemas[name] = rewriteLocalRefs(root, rename) as SchemaObject;

  for (const [definition, fragment] of Object.entries(definitions ?? {})) {
    schemas[rename(definition)] = rewriteLocalRefs(fragment, rename) as SchemaObject;
  }
}

function rewriteLocalRefs(value: unknown, rename: (definition: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteLocalRefs(item, rename));
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const rewritten: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    rewritten[key] =
      key === '$ref' && typeof child === 'string' && child.startsWith(LOCAL_DEFINITION_REF)
        ? `#/components/schemas/${rename(child.slice(LOCAL_DEFINITION_REF.length))}`
        : rewriteLocalRefs(child, rename);
  }

  return rewritten;
}
