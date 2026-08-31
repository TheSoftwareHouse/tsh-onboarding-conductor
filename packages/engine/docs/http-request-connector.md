# Generic HTTP request connector

The `http_request` connector performs one synchronous outbound HTTP call per step, driven entirely
by the connector declaration's `config` object. Integrating a provider whose API is a plain JSON
request/response therefore needs no engine code.

```json
{
  "name": "customer_registration",
  "id": "http_request",
  "type": "custom",
  "order": 1,
  "fieldMapping": { "customerEmail": "email", "customerAge": "age" },
  "config": {
    "request": {
      "method": "POST",
      "url": "{{secrets.kycProvider.baseUrl}}/v1/customers",
      "headers": { "Authorization": "Bearer {{secrets.kycProvider.token}}" },
      "query": { "onboarding": "{{execution.onboardingId}}" },
      "body": { "email": "{{payload.customerEmail}}", "age": "{{payload.customerAge}}" },
      "timeoutMs": 5000
    },
    "response": {
      "errorsPath": "errors",
      "errorStatuses": [401, 403]
    }
  }
}
```

The config is validated when workflows are loaded, so a malformed declaration fails engine startup
rather than a user's onboarding.

## `request`

| Key         | Required | Notes                                                                           |
| ----------- | -------- | ------------------------------------------------------------------------------- |
| `method`    | yes      | One of `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, uppercase                       |
| `url`       | yes      | Must resolve to an absolute `http:`/`https:` URL                                |
| `headers`   | no       | String values only                                                              |
| `query`     | no       | String values only; a value resolving to `null`/`undefined` omits the parameter |
| `body`      | no       | Any JSON value; rejected for `GET` and `DELETE`                                 |
| `timeoutMs` | no       | 100–30000, defaults to `HTTP_CONNECTOR_TIMEOUT_MS`                              |

Omitting `body` on a body-carrying method sends the whole mapped payload as the JSON request body,
which is the zero-config way to forward a step's fields. `Content-Type: application/json` is set
whenever a body is sent unless the declaration sets its own.

## `response`

| Key             | Required | Notes                                                                       |
| --------------- | -------- | --------------------------------------------------------------------------- |
| `errorsPath`    | no       | Dotted path to the field-errors object in a 4xx body, defaults to `errors`  |
| `errorStatuses` | no       | 4xx codes to treat as hard errors instead of invalid data, defaults to `[]` |

Outcome mapping:

- `2xx` — the connector accepts and the step proceeds.
- `4xx` — retryable invalid data. Field errors are read from `errorsPath` and are expected to be
  keyed by **payload** key; each key is translated back to its workflow field name through the
  step's `fieldMapping`. Unmatched keys pass through unchanged, and a response with no usable
  errors object yields `{ "_connector": ["HTTP_CONNECTOR_REQUEST_REJECTED"] }`.
- anything else — `3xx`, `5xx`, a network failure or a timeout throws `HttpConnectorRequestFailedError`.

List a status in `errorStatuses` when it means "the integration is misconfigured" rather than "the
user's data is wrong" — `401` and `403` are the usual candidates, since reporting those as field
errors would blame the end user for a rotated credential.

## Placeholders

Placeholders are `{{ <namespace>.<path> }}` and only three namespaces exist:

| Namespace                                      | Resolves to                                  |
| ---------------------------------------------- | -------------------------------------------- |
| `payload.<key>`                                | A key of the step's `fieldMapping`           |
| `secrets.<alias>.<key>`                        | An entry of the `HTTP_CONNECTOR_SECRETS` map |
| `execution.onboardingId`, `execution.stepName` | The current execution identity               |

Onboarding data is deliberately reachable only through `fieldMapping`, so there is no `context`
namespace — every field a request sends must be declared on the step.

A placeholder that is the entire string keeps the resolved value's JSON type, so
`"age": "{{payload.customerAge}}"` sends a number. A placeholder embedded in surrounding text is
string-interpolated and must resolve to a scalar.

## Secrets

Values that must not live in workflow JSON come from the `HTTP_CONNECTOR_SECRETS` environment
variable, a JSON object of aliases to string maps. This connector declares no `settingsSchema`,
so it is deliberately **not** operator-configurable and never appears on `/v1/admin/connectors`:
its aliases and keys are named by workflow JSON rather than by the adapter, so they are
deployment configuration, changed with a deploy rather than over the admin API.

```bash
HTTP_CONNECTOR_SECRETS='{"kycProvider":{"baseUrl":"https://api.example.com","token":"s3cr3t"}}'
```

Every `{{secrets.*}}` reference is checked against this map at workflow-load time, so a missing
secret fails startup. Resolved URLs, headers and bodies are never logged.

## Not supported

Async provider callbacks (`"async": true`), retries and backoff, writing the response body back
into the onboarding context, and non-JSON request or response bodies.
