# Decision records

**Only records with status `Accepted` are binding.** Every other status is history:
read it to see what was already considered, never apply it as a current constraint.
A `Superseded` record is read together with its successor, never alone.

| Path                                                                                       | Tags                                          | Description                                                                                                                                                                                     | Status   |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| [0001-runtime-connector-credentials.md](./0001-runtime-connector-credentials.md)           | connectors, credentials, security, encryption | Connector credentials are operator-configurable at runtime, stored as plaintext JSON with no environment fallback — confidentiality at rest is the database's responsibility, not the engine's. | Accepted |
| [0002-partial-connector-settings-updates.md](./0002-partial-connector-settings-updates.md) | connectors, credentials, api                  | `PATCH` merges one connector setting at a time, so an operator can change a field without resubmitting secrets the API never returns; `PUT` keeps its wholesale meaning.                        | Accepted |
