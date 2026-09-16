# packages/shared/

Not one package — a mount point for two independent workspace packages
(`pnpm-workspace.yaml` lists `packages/shared/*` alongside `packages/*`):

- `packages/shared/ddl-schema` (`@tsh/ddl-schema`) — substantive, see its own
  `CLAUDE.md`.
- `packages/shared/openapi` (`@tsh/openapi`) — no source; holds `engine.openapi.json`, the
  engine's OpenAPI document written by `pnpm openapi:generate`. Never edit it by hand; its
  `README.md` says how it is produced and checked.

`@tsh/shared` itself (this directory's own `package.json`) is also an empty
placeholder. Check for source under a subpackage before assuming it's implemented.
