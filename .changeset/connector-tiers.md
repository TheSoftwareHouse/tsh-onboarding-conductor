---
'@tsh/engine': minor
---

Separate production connectors from sandbox (mock) connectors and enforce the boundary at runtime.

All ten adapters previously sat in one flat directory and were registered unconditionally, so a production image shipped and could execute `mock_email_otp`, `mock_kyc_1` and friends. Two of them were fakes wearing a vendor's name: `TshKyc1Connector`/`TshKyc2Connector` returned `accepted()` after a five-second sleep.

- `ConnectorAdapter` gains a required `tier: 'production' | 'sandbox'` field, so a new connector cannot be added without choosing a side.
- Adapters moved to `adapters/production/` and `adapters/sandbox/`. `TshKyc1Connector`/`TshKyc2Connector` are now `MockKyc1Connector`/`MockKyc2Connector`, and their adapter `name` matches their already-mock `type`.
- Sandbox adapters register only when `SANDBOX_CONNECTORS_ENABLED=true`. `AppConfig` throws when that is set under `NODE_ENV=production`.
- `ConnectorsModule` fails startup when an adapter is registered in a list that disagrees with its declared tier.
- An ESLint `no-restricted-imports` boundary stops production code from importing `adapters/sandbox/*`.

**Breaking:** `WorkflowConnectorExecutorService.validateDeclarations` now throws `ConnectorAdapterNotRegisteredError` for a connector type the engine does not register, instead of deferring to execution time. A workflow referencing an unregistered type — a `mock_*` type on a production engine, for instance — now fails while the workflow registry loads rather than when the first applicant reaches that step.

**Breaking:** deployments that rely on the mock connectors must set `SANDBOX_CONNECTORS_ENABLED=true`. Compose and the e2e suites set it already.
