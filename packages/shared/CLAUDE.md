# packages/shared/

Not one package — a mount point for two independent workspace packages
(`pnpm-workspace.yaml` lists `packages/shared/*` alongside `packages/*`):

- `packages/shared/ddl-schema` (`@tsh/ddl-schema`) — substantive, see its own
  `CLAUDE.md`.
- `packages/shared/openapi` (`@tsh/openapi`) — no source; holds `engine.openapi.json`, the
  engine's OpenAPI document written by `pnpm openapi:generate`, and under `versions/<major.minor>/`
  the frozen document of each earlier minor, written once by the same command when the engine's
  version moved on. Never edit any of them by hand; its `README.md` says how they are produced
  and checked.

`@tsh/shared` itself (this directory's own `package.json`) is also an empty
placeholder. Check for source under a subpackage before assuming it's implemented.
