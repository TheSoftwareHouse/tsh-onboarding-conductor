/**
 * Rewrites what `@nestjs/swagger` emits for `nullable: true` into the form OpenAPI 3.1 defines.
 *
 * The decorators speak OpenAPI 3.0, where `nullable` is a keyword of its own. 3.1 adopts JSON
 * Schema 2020-12, which has no `nullable` and says the same thing with a `null` type alternative.
 * The document is built as 3.1 so the workflow schemas can be embedded unchanged, so the one
 * 3.0-ism the decorators still produce is translated here, once, rather than worked around in
 * every nullable property.
 */
export function toOpenApi31Dialect<T>(node: T): T {
  if (Array.isArray(node)) {
    return node.map((item) => toOpenApi31Dialect(item)) as T;
  }

  if (node === null || typeof node !== 'object') {
    return node;
  }

  const rewritten: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    rewritten[key] = toOpenApi31Dialect(child);
  }

  return (rewritten.nullable === true ? withNullAlternative(rewritten) : rewritten) as T;
}

const COMPOSITION_KEYWORDS = ['$ref', 'allOf', 'oneOf', 'anyOf'] as const;

function withNullAlternative(schema: Record<string, unknown>): Record<string, unknown> {
  const { nullable, ...rest } = schema;
  void nullable;

  // A composed schema cannot take a second type, because `allOf: [{ $ref }]` would still refuse
  // `null`; it becomes one arm of a `oneOf` with `null` as the other, keeping the description on
  // the outside where a reader looks for it.
  if (COMPOSITION_KEYWORDS.some((keyword) => keyword in rest)) {
    const { description, ...alternative } = rest;

    return {
      ...(description === undefined ? {} : { description }),
      oneOf: [alternative, { type: 'null' }],
    };
  }

  if (typeof rest.type === 'string') {
    // An enum enumerates every legal value, so `null` has to join it or the null arm is dead.
    const enumeration = Array.isArray(rest.enum) ? { enum: [...rest.enum, null] } : {};

    return { ...rest, type: [rest.type, 'null'], ...enumeration };
  }

  return rest;
}
