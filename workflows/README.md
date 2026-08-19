# Workflows

JSON workflow definitions loaded by the engine. Each scope is a separate
directory, and the scope a definition ships in decides how it is treated.

| Scope      | Directory   | Purpose                                             |
| ---------- | ----------- | --------------------------------------------------- |
| `built-in` | `built-in/` | Production-grade workflows shipped with the engine. |
| `fixtures` | `fixtures/` | Example workflows backing local development and CI. |
| `users`    | `users/`    | Your own workflows.                                 |

`built-in/` and `fixtures/` resolve relative to the repository root and are not
configurable. Only `users/` can be relocated, with the optional
`WORKFLOWS_USERS_DIR` environment variable; unset, it defaults to
`workflows/users`.

Only `.json` files directly inside a scope directory are discovered. Nested
directories and other file formats are ignored, and a missing scope directory
is treated as contributing no workflows.

`fixtures/` is skipped when `NODE_ENV=production`, so example workflows never
reach a production deployment.

## Database as the runtime source

Files are only the definition source. On startup the engine validates every
discovered file and writes it into the `workflows` table, keyed by
`(workflow_id, version)`; a definition that is already stored unchanged is left
alone, and a changed one is updated in place. Everything the engine serves at
runtime is then read back from that table, never from disk.

A workflow is addressed by its `id` and its `version`. Starting an onboarding
without an explicit version picks the highest stored version of that `id`;
existing onboardings stay pinned to the version they were created with, so
publishing a new revision means adding a file with the same `id` and a higher
`version` rather than editing the old one in place.
