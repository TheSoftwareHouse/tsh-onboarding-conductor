# Extending workflow field types and formats

`@tsh/ddl-schema` keeps two registries. Everything the package knows about a field type or a text
format lives in exactly one module, and every derived artifact — the workflow JSON Schema, the
validators, the step-data schemas — is composed from those registries **in memory**. There is no
checked-in schema file to keep in sync, and no generation step.

| Registry     | Port                               | Registry file                          |
| ------------ | ---------------------------------- | -------------------------------------- |
| Field types  | `src/fields/field-type.port.ts`    | `src/fields/field-type.registry.ts`    |
| Text formats | `src/formats/field-format.port.ts` | `src/formats/field-format.registry.ts` |

There are two ways in: **compile it in** (a built-in, below) or **mount it at startup**
(see [Mounting at runtime](#mounting-at-runtime)). Both end up in the same registry and are
subject to the same port.

The built-in types are `boolean`, `number`, `text`, `date`, `file`, `object`, `array` and `json`.
`json` is the smallest definition to copy: root level only, no `validation` keys (`validateValidation`
fails every one), a bare `{ "type": "object" }` data schema and no condition levels, because it
exists to carry an open value — a provider's report — that `object` cannot hold.

## Adding a field type

1. **Create `src/fields/<type>.field-type.ts`** exporting a definition written
   `as const satisfies WorkflowFieldTypeDefinition`. The `as const` matters: an explicit
   `: WorkflowFieldTypeDefinition` annotation widens `type` to `string` and breaks the
   `WorkflowFieldType` union derived from the registry.

   | Member                     | What it owns                                                                         |
   | -------------------------- | ------------------------------------------------------------------------------------ |
   | `type`                     | Canonical name and the discriminator written into normalized fields                  |
   | `aliases`                  | Legacy spellings resolved to `type` (`string` → `text`)                              |
   | `levels`                   | Where the type may appear: `root`, `nested`, `arrayItem`                             |
   | `maxOccurrencesPerStep`    | Optional per-step limit (`file` uses `1`)                                            |
   | `alwaysRequiredInStepData` | Step data must carry the field even when `required` is `false` (`file`)              |
   | `buildValidationSchema`    | The shared `<type>Validation` definition, or `undefined` when inlined                |
   | `buildDescriptorSchema`    | The descriptor for one level — use `buildFieldDescriptorSchema`                      |
   | `validateValidation`       | Semantic rules for the `validation` object; call `fail('INVALID_VALUE')`             |
   | `normalizeField`           | Builds the normalized field — use `buildFieldEnvelope`, recurse via `normalizeChild` |
   | `buildDataSchema`          | The JSON Schema submitted step data must satisfy                                     |
   | `validateConditionLiteral` | Optional; omit it and the type cannot be compared in a `when` condition              |

2. **Register it** by adding the definition to `BUILT_IN_FIELD_TYPES` in
   `src/fields/field-type.registry.ts`. The array order is the order the schema lists descriptors
   in.

That is the whole change — there is no third step. `workflow-validator.ts`,
`workflow-step-validator.ts`, `workflow-contract.ts` and the schema need no edit, and no artifact
needs regenerating. `src/fields/field-type-extension.spec.ts` proves it by registering a synthetic
`money` type through an injected registry.

## Adding a text format

1. Create `src/formats/<name>.format.ts` exporting a definition with `name`, `provider` and, for
   `provider: 'custom'`, a `validate` predicate. Use `provider: 'ajv-formats'` when `ajv-formats`
   already implements the format.
2. Add it to `BUILT_IN_FIELD_FORMATS` in `src/formats/field-format.registry.ts`. The array order is
   the order of the `format` enum.

The step-data Ajv instance registers every `custom` entry automatically, and the workflow-level
`format` check accepts exactly the registered names.

## Mounting at runtime

A field type or format that is not compiled in — one loaded from a mounted volume, a plugin
directory, or configuration — is registered during application startup, before the first workflow
is validated:

```ts
import { registerFieldFormat, registerFieldType } from '@tsh/ddl-schema';

registerFieldType(durationFieldTypeDefinition);
registerFieldFormat({ name: 'sort-code', provider: 'custom', validate: isSortCode });
```

Nothing else is needed. The schema and its compiled Ajv validator are built on first use and keyed
to a registry version, so registering invalidates them and the next validation sees the mounted
definition. `src/fields/field-type-mounting.spec.ts` covers the whole path: rejected before
registration, accepted after, present in the schema, and still subject to its own validation rules.

Two constraints:

- **Register during startup.** Registering after workflows are already being validated is allowed —
  the contract rebuilds — but a workflow accepted under the old contract is not re-checked.
- **Mounted names are `string` to the compiler.** `WorkflowFieldTypeName` widens to `string`, so a
  mounted type cannot be discriminated at compile time. Use the registry, or a type guard the
  definition module exports, exactly as `isNormalizedFileField` does.

## Rules the registries rely on

- **Untrusted keys.** Type and format names come from workflow JSON, so lookups go through `Map`s.
  Never index a plain object with a name from a definition.
- **No runtime edge back to the contract.** Field and format modules import from
  `workflow-contract.ts` with `import type` only; the contract derives its unions the same way.
- **Reasons are fixed.** The nine `WorkflowInvalidReason` values are a public contract. A new type
  fails with `INVALID_VALUE`; do not add a reason.

## Descriptor quirks a new type must respect

These are deliberate and pinned by `src/schema/workflow-json-schema.spec.ts`; do not "fix" them
while adding a type:

- Root `object` and `array` descriptors omit `when`; their nested counterparts declare it.
- `file` has no shared `fileValidation` definition — its validation object is inlined in the
  descriptor — and it is root-only with `required` pinned to `true`.
- `text` declares `"type": { "enum": ["text", "string"] }`; every other type uses `const`.
- `boolean` has no `manyOf`.
- `array` validation exists only at the array level, never on its items.
- `json` is root-only, accepts no `validation` and its descriptor declares no condition levels.
