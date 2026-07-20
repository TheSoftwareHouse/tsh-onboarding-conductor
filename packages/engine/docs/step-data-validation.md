# Step data validation

Workflow steps declare the fields that a user may submit. Each field is a descriptor with a `type`, a boolean `required` flag, and an optional `validation` object. The validator accepts only the declared fields and checks submitted JSON values against the field types and constraints.

## Field types

```json
{
  "data": {
    "enabled": { "type": "boolean", "required": true },
    "quantity": { "type": "number", "required": true },
    "displayName": { "type": "text", "required": true },
    "startDate": { "type": "date", "required": false }
  }
}
```

The supported types are `boolean`, `number`, `text`, and `date`:

- `boolean` accepts JSON `true` or `false`.
- `number` accepts a JSON number. Values are not converted from strings.
- `text` accepts a JSON string. The legacy type name `string` is accepted in a workflow definition and normalizes to `text`.
- `date` accepts a calendar date in `YYYY-MM-DD` form, such as `2026-07-17`.

`required: true` means the field must be present in submitted step data. `required: false` makes it optional; an omitted optional field is valid. A submitted field is still validated when it is optional.

AJV does not coerce values. For example, `{"quantity": "3"}` does not satisfy a `number` field, and `{"enabled": "true"}` does not satisfy a `boolean` field. Fields not declared in the step are rejected, so `{"displayName": "Ada", "admin": true}` is invalid when `admin` is not declared.

## Text constraints

Text fields support length, regular-expression, format, and selection constraints. Constraints on one field are cumulative: a value must satisfy every declared constraint.

```json
{
  "data": {
    "username": {
      "type": "text",
      "required": true,
      "validation": {
        "minLength": 3,
        "maxLength": 20,
        "pattern": "^[A-Za-z0-9_]+$"
      }
    },
    "email": {
      "type": "text",
      "required": true,
      "validation": { "format": "email" }
    }
  }
}
```

- `minLength` and `maxLength` are inclusive string-length limits.
- `pattern` is a regular expression that the string must match.
- `format: "email"` requires an email-formatted string.

The format validators for sensitive account values are also text constraints:

```json
{
  "data": {
    "cardNumber": {
      "type": "text",
      "required": true,
      "validation": { "format": "credit-card" }
    },
    "iban": {
      "type": "text",
      "required": true,
      "validation": { "format": "account-number" }
    }
  }
}
```

`credit-card` allows 13 to 19 digits, ignores spaces and hyphens for validation, and applies a Luhn check. Card values are masked before accepted data is persisted: for example, `4111-1111-1111-1111` is stored as `************1111`.

`account-number` validates an IBAN-style value after removing whitespace and treating letters as uppercase for the check. The submitted value itself is preserved after validation, including its original casing and whitespace. For example, ` de89 3704 0044 0532 0130 00` remains exactly that value in accepted data.

## Numeric bounds

Number fields support inclusive and exclusive bounds. These constraints are cumulative with each other and with a numeric selection constraint.

```json
{
  "data": {
    "age": {
      "type": "number",
      "required": true,
      "validation": {
        "minimum": 18,
        "maximum": 120,
        "exclusiveMinimum": 17,
        "exclusiveMaximum": 121
      }
    }
  }
}
```

- `minimum` includes its boundary: `18` is valid for `minimum: 18`.
- `maximum` includes its boundary: `120` is valid for `maximum: 120`.
- `exclusiveMinimum` excludes its boundary: `18` is valid for `exclusiveMinimum: 17`, but `17` is not.
- `exclusiveMaximum` excludes its boundary: `120` is valid for `exclusiveMaximum: 121`, but `121` is not.

## Selections: `oneOf` and `manyOf`

`oneOf` is a scalar selection. The submitted field value must equal one item in the declared list. The list must be non-empty and contain unique values.

```json
{
  "data": {
    "status": {
      "type": "text",
      "required": true,
      "validation": { "oneOf": ["active", "pending"] }
    },
    "acceptedTerms": {
      "type": "boolean",
      "required": true,
      "validation": { "oneOf": [true] }
    },
    "deliveryDate": {
      "type": "date",
      "required": true,
      "validation": { "oneOf": ["2026-07-17", "2026-07-18"] }
    }
  }
}
```

`manyOf` is a unique, non-empty array selection. Every array item must be one of the declared values, and duplicate submitted items are rejected. It is available for text, number, and date fields.

```json
{
  "data": {
    "tags": {
      "type": "text",
      "required": false,
      "validation": { "manyOf": ["vip", "urgent", "review"] }
    },
    "scores": {
      "type": "number",
      "required": true,
      "validation": { "manyOf": [1, 2, 3] }
    },
    "availableDates": {
      "type": "date",
      "required": true,
      "validation": { "manyOf": ["2026-07-17", "2026-07-18"] }
    }
  }
}
```

For example, `{"tags": ["vip", "urgent"]}` is valid, while `{"tags": "vip"}`, `{"tags": []}`, and `{"tags": ["vip", "vip"]}` are invalid. A field cannot declare both `oneOf` and `manyOf`.
