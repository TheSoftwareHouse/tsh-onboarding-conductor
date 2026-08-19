# Connector Adapters

Adapters are grouped by who owns them, mirroring the `email-templates/` scopes.
Every group implements the same `ConnectorAdapter` port and is registered in
[`../connectors.module.ts`](../connectors.module.ts).

| Group      | Directory   | Purpose                                                       |
| ---------- | ----------- | ------------------------------------------------------------- |
| `built-in` | `built-in/` | Production-grade adapters shipped with the engine.            |
| `fixtures` | `fixtures/` | Mocks and stand-ins backing the checked-in example workflows. |
| `users`    | `users/`    | Your own adapters.                                            |

Fixtures exist so the example workflows in `workflows/` run without third-party
credentials. They fake their provider — never point a production workflow at one.

Built-in adapters talk to real providers and are configured entirely through
environment variables, so they are named after the protocol or vendor they
speak to (`smtp`, `sendgrid_email`, `twilio_verify`, `http_request`), never
after a particular development server.

To add your own adapter, drop it in `users/`, implement `ConnectorAdapter`, and
add it to `USER_CONNECTOR_ADAPTER_PROVIDERS` in `../connectors.module.ts`.
Connector `type` values must be unique across all three groups; the module
throws on startup if two adapters claim the same one.
