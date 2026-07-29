# Step data validation

Workflow steps declare a `data` map of field descriptors. Validation is strict:

- unknown submitted root fields are rejected
- unknown nested object properties are rejected
- values are never coerced (AJV strict validation)

Legacy `type: "string"` is accepted anywhere a text descriptor is allowed and is normalized to `type: "text"`.

## Root field types

Supported root types are `boolean`, `number`, `text`, `date`, `file`, `object`, and `array`.

For all root fields except `file`:

- `required` is mandatory
- `persist` is optional, defaulting to `true`

For `file`:

- `required` must be `true`
- `validation` is required with `contentTypes` and `maxSizeBytes`

## Structured fields

`object` descriptors require a non-empty `fields` map.

```json
{
  "profile": {
    "type": "object",
    "required": true,
    "persist": false,
    "fields": {
      "profileId": {
        "type": "text",
        "required": true,
        "validation": { "format": "uuid" }
      },
      "links": {
        "type": "array",
        "required": true,
        "items": {
          "type": "text",
          "validation": { "format": "uri" }
        }
      }
    }
  }
}
```

`array` descriptors require exactly one recursive `items` descriptor and optionally support `validation.minItems` and `validation.maxItems`.

Array item descriptors:

- do not define `required`
- can be primitive, `object`, or `array`
- cannot be `file`

If a root field is `array`, non-array submitted values invalidate that root field.

## Root-only `persist`

`persist` is supported only on root descriptors. Nested `persist` declarations are rejected at workflow normalization.

Runtime behavior:

- root `persist: true` (or omitted): value is accepted into onboarding context
- root `persist: false`: value is validated and forwarded to connector execution, but excluded from accepted data/context

For structured roots (`object` or `array`), the whole root value follows this rule as one unit.

## Text validation formats

Text validation supports:

- `email`
- `credit-card`
- `account-number`
- `uuid`
- `uri`
- `phone`

`uuid` and `uri` use `ajv-formats`.

`phone` is strict E.164 without normalization:

```text
^\+[1-9]\d{1,14}$
```

Examples:

- valid: `+14155552671`
- invalid: `14155552671`

`credit-card` and `account-number` behavior is unchanged. Credit cards are still masked before entering accepted data (`************1111`).

## Other validation semantics

Existing validation keys and selection semantics remain unchanged:

- text: `minLength`, `maxLength`, `pattern`, `format`, `oneOf`, `manyOf`
- number: `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `oneOf`, `manyOf`
- boolean: `oneOf`
- date: `oneOf`, `manyOf`
- array: `minItems`, `maxItems`

`oneOf` and `manyOf` cannot be declared together on the same field.
