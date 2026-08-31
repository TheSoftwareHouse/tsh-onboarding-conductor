# Decision records

**Only records with status `Accepted` are binding.** Every other status is history:
read it to see what was already considered, never apply it as a current constraint.
A `Superseded` record is read together with its successor, never alone.

| Path                                                                                       | Tags                                          | Description                                                                                                                                                                                     | Status     |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [0001-runtime-connector-credentials.md](./0001-runtime-connector-credentials.md)           | connectors, credentials, security, encryption | Connector credentials are operator-configurable at runtime, stored as plaintext JSON with no environment fallback — confidentiality at rest is the database's responsibility, not the engine's. | Accepted   |
| [0002-partial-connector-settings-updates.md](./0002-partial-connector-settings-updates.md) | connectors, credentials, api                  | `PATCH` merges one connector setting at a time, so an operator can change a field without resubmitting secrets the API never returns; `PUT` keeps its wholesale meaning.                        | Accepted   |
| [0003-admin-panel-runtime-configuration.md](./0003-admin-panel-runtime-configuration.md)   | admin-panel, docker, configuration            | The admin panel ships as its own unprivileged nginx image, configured at runtime from a container-generated `config.js`, the same as the engine, so a `VITE_*` change needs no rebuild.         | Superseded |
| [0004-admin-panel-served-by-the-engine.md](./0004-admin-panel-served-by-the-engine.md)     | admin-panel, engine, docker, configuration    | The admin panel ships inside the engine's image and is served by the engine from the same origin, keeping 0003's runtime `config.js` but rendering it from `ConfigService` instead of nginx.    | Accepted   |
