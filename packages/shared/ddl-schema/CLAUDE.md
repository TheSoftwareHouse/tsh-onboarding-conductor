# Workflow contract conventions — `packages/shared/ddl-schema`

Scoped rules for `packages/shared/ddl-schema/**`. The root `CLAUDE.md` applies in full; this file adds
the contract-package conventions and, where noted, overrides a global rule.

This package defines what a valid workflow JSON document is, and normalizes a raw one into the shape
the engine evaluates. It is the reason "integration is configuration, not code" holds: a new field
type, text format or condition operator is added here as a declaration, and no engine code changes.

## Two hard boundaries

1. **Framework-free.** No Nest, no HTTP, no TypeORM, no `process.env`. This package is plain
   TypeScript and must stay importable by anything.
2. **Consumed as a build artifact.** `@tsh/ddl-schema` resolves to `dist/`, so a consumer only sees
   what `src/index.ts` exports. Adding a file changes nothing until it is exported there, and the
   engine's `typecheck` and `test:e2e` scripts build this package first for that reason. Jest maps the
   alias back to `src`, which is why a stale `dist` shows up as an e2e failure and not a unit failure.

## Layout and file names

One directory per construct — `fields/`, `formats/`, `conditions/`, `connectors/`, `steps/`,
`transitions/`, `webhooks/`, `schema/` — with the role in the suffix:

| Suffix                            | Role                                                           |
| --------------------------------- | -------------------------------------------------------------- |
| `*.port.ts`                       | the interface a variant must implement                         |
| `*.registry.ts`                   | the built-in list plus the `register*` / `list*` mounting seam |
| `*.field-type.ts` / `*.format.ts` | one variant, exporting `<name><Kind>Definition`                |
| `*.normalizer.ts`                 | raw JSON → normalized shape for one construct                  |
| `*.validator.ts`                  | invariant checks                                               |
| `*.builder.ts`                    | JSON Schema construction                                       |
| `*.error.ts`                      | the package's error contract                                   |

## Ports and registries are the extension seam

Adding a variant means **one module implementing the port plus one entry in the registry** — never a
new branch in a switch, and never a change to the normalizer that walks the tree. `docs/extending-field-types.md`
is the canonical guide for field types and text formats; read it before adding either.

- The built-in set is a `const … as const satisfies readonly Definition[]` array, so the compiler
  derives the union of built-in names and aliases from the array itself.
- Read the live set through `listFieldTypes()`, never from the built-in array: externally mounted types
  are registered at startup and are absent from it.
- The public name type is widened on purpose (`BuiltIn… | (string & Record<never, never>)`) because a
  mounted type contributes a name the compiler cannot know. Keep both halves — narrowing it breaks
  mounting, widening it to `string` loses autocomplete on the built-ins.
- **Registries are `Map`s, not objects.** Keys come from untrusted workflow JSON and must not reach
  `Object.prototype`. Do not "simplify" one into a record literal.

## Errors — one contract, many reasons

This package raises a single `WorkflowInvalidError` carrying a `WorkflowInvalidReason` from a closed
union, thrown through the `failWorkflow(reason)` helper that returns `never`:

```ts
export const failWorkflow = (reason: WorkflowInvalidReason): never => {
  throw new WorkflowInvalidError(reason);
};
```

One error with a reason union is right here because every failure in this package is the same event: a
workflow document is invalid and the process must not start with it. It is a load-time assertion, not
an HTTP response, so there is no per-case status or client contract to own. The reason union is itself
the single named contract the root file's domain-constants rule asks for.

Add a new member to the reason union rather than a new error class, and pass `fail` down into port
implementations instead of throwing directly from them.

**This does not override anything.** The engine's `*.exception.ts` / `*.error.ts` split is scoped to
`packages/engine/src/**` and never applied here. Engine conventions do not propagate outward: only the
root `CLAUDE.md` is global, and a package file needs to override a rule only when the root states it.

## Typing

- `Record<string, unknown>` is the correct type for raw, un-normalized JSON — but name the boundary
  (`JsonSchemaFragment`) rather than spreading the bare type through signatures.
- Normalized shapes are concrete and named. The shared envelope (`AnyNormalizedField`) carries only
  what every field has; type-specific members stay in the module that produced them.
- Mark normalization context fields `readonly`. A normalizer must not mutate what it was handed.

## Tests

Jest, co-located `*.spec.ts`. Beyond per-unit tests, the suite covers the seams themselves —
`field-type-extension.spec.ts` and `field-type-mounting.spec.ts` assert that registering a type from
outside works. A change to a port or registry needs a test at that level, not only on the new variant.
