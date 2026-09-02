# Connector Error Handlers

An error handler is a policy: given a connector call that threw, it decides what the engine
does next. It never performs that decision itself — `handle` is synchronous and pure, and the
executor is the only thing that retries, falls back, continues or propagates.

Handlers are grouped by who owns them, mirroring [`../adapters/`](../adapters/README.md). Every
group implements the same `ConnectorErrorHandler` port
([`../ports/connector-error-handler.port.ts`](../ports/connector-error-handler.port.ts)) and is
registered in [`../connectors.module.ts`](../connectors.module.ts).

| Group      | Directory   | Purpose                           |
| ---------- | ----------- | --------------------------------- |
| `built-in` | `built-in/` | Handlers shipped with the engine. |
| `users`    | `users/`    | Your own handlers.                |

## The port

```ts
export interface ConnectorErrorHandler {
  readonly id: string;
  handle(failure: ConnectorFailure): ConnectorFailureAction;
}
```

`id` is the value a workflow's connector declaration names in its `errorHandler` field. `handle`
receives a `ConnectorFailure` — the declaration that failed, the thrown error, the `status` when
the error was an `HttpException`, the current `attempt`, the declaration's resolved `retry` policy,
and whether a further link of the fallback chain is available — and returns one of four actions:

| Action      | Meaning                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `retry`     | Call the same connector again, after its `retry.delayMs`. Bounded by `retry.maxAttempts`. |
| `fallback`  | Run the next link of the declaration's `fallback` chain in its place.                     |
| `continue`  | Swallow the failure: this connector counts as accepted, the chain moves on.               |
| `propagate` | Rethrow. The step does not advance and the caller sees the provider's error.              |

A handler is policy, never the loop guard. The executor overrides a decision it cannot honour —
a `retry` past `retry.maxAttempts` (`attempts_exhausted`) or past the slot's 20-second waiting
budget (`retry_delay_budget_exhausted`), a `fallback` at the end of the chain
(`fallback_unavailable`), or an action outside the four (`invalid_handler_action`) — to
`propagate`, and names the reason in the audit row.

A declaration that names no `errorHandler` gets `fallback_on_error`
(`DEFAULT_CONNECTOR_ERROR_HANDLER_ID`).

## Built-in handlers

| id                    | Decides                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fallback_on_error`   | Falls back when one is available, else propagates. The default.                                                                                           |
| `retry_then_fallback` | A 4xx status goes straight to fallback-or-propagate; a 5xx or statusless failure retries while `retry.maxAttempts` allows, then falls back or propagates. |
| `continue_on_error`   | Always continues.                                                                                                                                         |

## Adding your own

Drop it in `users/`, implement `ConnectorErrorHandler`, and add it to
`USER_CONNECTOR_ERROR_HANDLER_PROVIDERS` in `../connectors.module.ts`. Handler `id` values must
be unique across all groups; the module throws on startup if two handlers claim the same one.
