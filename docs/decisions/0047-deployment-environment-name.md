# 0047. Each deployment names its environment and requires `NODE_ENV`

- **Status:** Accepted
- **Date:** 2026-10-15
- **Tags:** configuration, security, admin-panel, delivery
- **Supersedes:** —
- **Superseded by:** —

## Decision

**One engine deployment is one environment.** It declares which with two required variables and
no defaults: `ENVIRONMENT_NAME`, a lowercase slug (`^[a-z0-9][a-z0-9-]{0,62}$`) chosen by whoever
runs it — `dev`, `staging`, `pre-prod`, `prod` or any other stage of their promotion path — and
`NODE_ENV`, now one of `development`, `production` or `test` (`NodeEnv`,
`config/environment.config.ts`) instead of an optional free string defaulting to `development`. A
deployment missing either refuses to start.

**`NODE_ENV` stays the only input to policy; the name never is.** `production` keeps every rule it
already drove — fixture workflows and adapters not loaded or selectable, HTTPS for
`CLIENT_WEBHOOK_BASE_URL`, unsigned connector callbacks refused unless
`CONNECTOR_CALLBACK_UNSIGNED_TYPES` names the adapter, `ADMIN_AUTH_ENABLED=false` refused — and
`test` still marks the only runs `CONNECTOR_MOCKS` applies to. Dev and staging run `development`;
pre-prod and prod run `production`.

**The admin panel shows the environment.** The engine derives `VITE_ENVIRONMENT_NAME` into
`/config.js` beside `VITE_NODE_ENV`; the sidebar's `EnvironmentBadge` prints the name under the
brand, outlined red under `NODE_ENV=production` whatever it is called.

**Compose demands both from `.env`.** The engine and worker services take `NODE_ENV` and
`ENVIRONMENT_NAME` as `${VAR:?…}` rather than pinning `NODE_ENV: development`, so one Compose
file serves any environment and Compose itself refuses to start when `.env` is missing either. The
image bakes in neither, and the engine never falls back to `.env.dist`, so a container or process
run without them refuses to start instead of picking up production's or the sample's rules.

Out of scope: environments are not a dimension inside one deployment. Connector credentials,
connector selections, workflows and onboardings are not partitioned by environment, and the public
API does not name one.

## Context

The requirement was to let an operator run dev, staging, pre-prod and prod, grouped into
development-like and production-like. `NODE_ENV` already carried that split, but as an optional
string any value of which other than `production` silently counted as non-production — a typo such
as `prod` relaxed every guard — and nothing told an operator in the panel which environment they
were changing.

## Alternatives

| Option                                                                         | Why not                                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A separate `ENVIRONMENT_TIER` (`dev`/`prod`) deciding policy instead           | Built first and withdrawn: a second variable that can disagree with `NODE_ENV`, for a split `NODE_ENV` already expresses; the cost is that a staging deployment runs Node in development mode |
| Many environments inside one engine, credentials and onboardings scoped by one | Partitions every table and route for a need that separate deployments with separate databases already meet                                                                                    |
| A fixed list of four environment names                                         | A promotion path is the operator's to name (`prod-eu`, `uat`); fixing the list buys nothing `NODE_ENV` does not already decide                                                                |

## Consequences

Every environment's `.env` needs `ENVIRONMENT_NAME`, and an `.env` copied before this change stops
the Compose stack until it is added. `NODE_ENV` must be one of the three values; anything else is
refused at start instead of being read as non-production.

Staging and other development-mode deployments run Node with `NODE_ENV=development`, so libraries
that branch on it behave as they do locally. The engine's own error responses do not depend on it.

Separating pre-prod's sandbox credentials from prod's live ones depends on each environment having
its own database, as any deployment of the Compose stack already does.
