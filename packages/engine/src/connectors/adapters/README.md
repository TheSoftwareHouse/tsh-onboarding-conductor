# Connector Adapters

Adapters are grouped by who owns them, mirroring the `workflows/` and
`email-templates/` scopes. Every group implements the same `ConnectorAdapter`
port and is registered in [`../connectors.module.ts`](../connectors.module.ts).

| Group      | Directory   | Purpose                                                       |
| ---------- | ----------- | ------------------------------------------------------------- |
| `built-in` | `built-in/` | Production-grade adapters shipped with the engine.            |
| `fixtures` | `fixtures/` | Mocks and stand-ins backing the checked-in example workflows. |
| `users`    | `users/`    | Your own adapters.                                            |

`GET /v1/admin/connectors` reports the group name as each entry's `scope`. It is read from the
provider array in [`../connectors.module.ts`](../connectors.module.ts) that registers the
adapter, matched by exact constructor identity, and is never stored anywhere.

Fixtures exist so the example workflows in `workflows/fixtures/` run without
third-party credentials. They fake their provider — never point a production
workflow at one.

Every fixture says so in its name: connector id, class name and filename all begin with
`mock` (`mock_kyc_1` / `MockKyc1Connector` / `mock-kyc.connector.ts`). A fake is therefore
recognisable wherever it turns up — a workflow's connector declaration, an audit row, an
import — without opening this directory. Keep the prefix on any fixture you add. A
workflow's connector `name` is a free label the audit trail also records, so a declaration
pointing at a fixture must not label it after a real provider.

Built-in adapters talk to real providers and are named after the protocol or
vendor they speak to (`smtp`, `sendgrid_email`, `twilio_verify`, `http_request`),
never after a particular development server.

Three of the four declare a `settingsSchema` and read their credentials through
`ConnectorSettingsService`, so an operator can supply and rotate them at
runtime over `/v1/admin/connectors` instead of through environment variables —
the database is the only source, there is no environment fallback, and an
unresolvable required credential surfaces as `503 CONNECTOR_NOT_CONFIGURED` at
execution time. `http_request` is the exception and declares no `settingsSchema`:
its secret aliases are named by workflow JSON rather than by the adapter, so they
stay deployment configuration in `HTTP_CONNECTOR_SECRETS` and it never appears on
`/v1/admin/connectors`. Confidentiality at rest is the deployment database's
responsibility, not the engine's: the `settings` column is plaintext JSON. See
`docs/IMPLEMENTATION.md` §4 ("Operator-provided settings") for the resolution
order and the admin routes.

## Standing in for a built-in adapter during e2e runs

A production workflow cannot be exercised end to end when its connector talks to a
paid or side-effecting third party. Configuration says which fixture takes its place:

```bash
# .env — shipped as the default in .env.dist
CONNECTOR_MOCKS=twilio_verify:mock_phone_verification,sendgrid_email:mock_email_delivery
```

Each entry is `<connector id>:<mock connector id>`. The executor sends declarations
of the first type to the adapter registered under the second, so workflows, field
mappings and callback routes stay exactly as they are.

The mocks are named after what they do, not after a vendor, so one serves every provider
of the same kind:

| Mock connector id         | Does                                   | Used for                     |
| ------------------------- | -------------------------------------- | ---------------------------- |
| `mock_phone_verification` | issues a code, then checks it          | `twilio_verify`, SMS vendors |
| `mock_email_verification` | the same over email                    | email-OTP providers          |
| `mock_email_delivery`     | takes a templated message and keeps it | `sendgrid_email`, mail APIs  |

They are ordinary fixtures — same `ConnectorAdapter` port, own connector ids,
registered like every other fixture — so a fixture workflow can also name one directly.
`smtp` and `http_request` need nothing here: the first runs against the MailHog
container, the second against a server the test starts itself.

To serve a provider that words its declarations differently, add the spelling to the
mock's alias list (`CHALLENGE_OPERATIONS` / `VERIFY_OPERATIONS`, or
`TEMPLATE_DATA_PREFIXES`). Both mocks already read the wording of the connectors above
alongside their own.

What the fixtures share — issued codes and their limits, and the correlation a parked
step needs — lives in [`fixtures/support/`](fixtures/support/), which holds no adapters
and registers nothing.

### Synchronous and asynchronous declarations

Which mode a step runs in is the workflow's choice — `async` on the connector
declaration — so both mocks implement both. With `async: false` the verdict comes
straight from `execute`. With `async: true`, `execute` only initiates: the engine parks
the step, and the verdict arrives at `POST /v1/webhooks/:connectorId/callback`, which
the mock maps through `mapCallbackResult`. Standing in for a connector that has no
callbacks simply leaves the async half unused.

Tests speak for the provider through the mock:

```ts
const mock = app.get(MockPhoneVerificationConnector);
const code = mock.__peekCodeForTests(onboardingId); // what the provider "sent"
mock.__setNowForTests(() => later); // force CHALLENGE_EXPIRED

const initiation = mock.__peekInitiationForTests(onboardingId);
const callback = mock.__buildProviderCallbackForTests({
  providerReference: initiation.providerReference,
  submittedData: { verificationCode: code }, // resuming replays the step's data
});
```

Correlation stays on the provider's side of the fence: the callback body carries the
provider's own reference, never the engine's onboarding id, and a body that tries to is
refused.

### Only in e2e runs

`CONNECTOR_MOCKS` lives in `.env` like any other setting — `.env.dist` ships the pairs
above as its default — but **only a `NODE_ENV=test` run applies them**. Every other
environment, development included, reads the value, resolves no substitution and logs that
it ignored it, so no deployment can end up with a fake answering for a real provider.

Where they do apply, startup fails when either side of a pair is not registered, so a typo
can never quietly leave the real provider in place. Outside a test run even an impossible
pair is inert, so a stale entry cannot stop a deployment from booting.

Because substitution happens at lookup, audit rows and callback provider keys record the
mock's own connector id — a mocked run is traceable as such.

To add your own adapter, drop it in `users/`, implement `ConnectorAdapter`, and
add it to `USER_CONNECTOR_ADAPTER_PROVIDERS` in `../connectors.module.ts`. That
registration is the only thing that makes it report `scope: "users"` on
`/v1/admin/connectors` — nothing else to declare.
Connector `type` values must be unique across all groups; the module
throws on startup if two adapters claim the same one.
