# Extending workflow field types and formats

`@tsh/ddl-schema` keeps two registries. Everything the package knows about a field type or a text
format lives in exactly one module, and both the runtime validators and the committed JSON Schema
read that module. Adding a variant is a local change; nothing central needs editing.

| Registry     | Port                               | Registry file                          |
| ------------ | ---------------------------------- | -------------------------------------- |
| Field types  | `src/fields/field-type.port.ts`    | `src/fields/field-type.registry.ts`    |
| Text formats | `src/formats/field-format.port.ts` | `src/formats/field-format.registry.ts` |

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

2. **Register it** by adding the definition to `FIELD_TYPE_DEFINITIONS` in
   `src/fields/field-type.registry.ts`. The array order is the order the generated schema lists
   descriptors in.

3. **Regenerate the contract**:

   ```sh
   pnpm --filter @tsh/ddl-schema schema:generate
   pnpm format:fix
   ```

   `src/schema/workflow-json-schema.spec.ts` fails when the committed
   `onboarding-workflow.schema.json` is stale, so this step is not optional.

That is the whole change. `workflow-validator.ts`, `workflow-step-validator.ts`,
`workflow-contract.ts` and the JSON Schema need no edit —
`src/fields/field-type-extension.spec.ts` proves it by registering a synthetic `money` type through
an injected registry.

## Adding a text format

1. Create `src/formats/<name>.format.ts` exporting a definition with `name`, `provider` and, for
   `provider: 'custom'`, a `validate` predicate. Use `provider: 'ajv-formats'` when `ajv-formats`
   already implements the format.
2. Add it to `FIELD_FORMAT_DEFINITIONS` in `src/formats/field-format.registry.ts`. The array order
   is the order of the generated `format` enum.
3. Regenerate the contract as above.

The step-data Ajv instance registers every `custom` entry automatically, and the workflow-level
`format` check accepts exactly the registered names.

## Rules the registries rely on

- **Untrusted keys.** Type and format names come from workflow JSON, so lookups go through `Map`s.
  Never index a plain object with a name from a definition.
- **No runtime edge back to the contract.** Field and format modules import from
  `workflow-contract.ts` with `import type` only; the contract derives its unions the same way.
- **Reasons are fixed.** The nine `WorkflowInvalidReason` values are a public contract. A new type
  fails with `INVALID_VALUE`; do not add a reason.

## Descriptor quirks a new type must respect

These are deliberate and reproduced by the generator; do not "fix" them while adding a type:

- Root `object` and `array` descriptors omit `when`; their nested counterparts declare it.
- `file` has no shared `fileValidation` definition — its validation object is inlined in the
  descriptor — and it is root-only with `required` pinned to `true`.
- `text` declares `"type": { "enum": ["text", "string"] }`; every other type uses `const`.
- `boolean` has no `manyOf`.
- `array` validation exists only at the array level, never on its items.
