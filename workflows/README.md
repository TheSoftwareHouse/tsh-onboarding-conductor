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

## One authored form

A definition declares `steps`, each naming a step type, wired together by their
named outcomes. They are compiled into the one step shape the engine runs as the
workflow loads, so every structural rule is checked on what it runs. A
definition still written as untyped steps — that compiled shape, with no `type`
on a step — is refused with `INVALID_SHAPE` at that step;
`pnpm workflow:compile <file> --from-untyped` prints the document to save in its
place, one `custom` step per step.

`built-in/` ships the same flow both ways: `eu-b2c-individual-kyc-eea.workflow.json`
is revision 1 as `custom` steps, one hand-written step each, and
`eu-b2c-individual-kyc-eea-v2.workflow.json` is revision 2 through the
specialized step types; a spec asserts the two are identical once normalized.
Every example in `fixtures/` ships twice the same way: `<name>.workflow.json`
in `custom` steps and `<name>-typed.workflow.json` in specialized steps.
Copy whichever suits you; `docs/EXTENDING.md` covers the vocabulary, and
`pnpm workflow:compile <file>` prints what a document compiles to — or where it
fails.

`fixtures/` is skipped when `NODE_ENV=production`, so example workflows never
reach a production deployment.

## Database as the runtime source

Files are only the definition source. On startup the engine validates every
discovered file and writes it into the `workflows` table, keyed by
`(workflow_id, version)`; a definition that is already stored unchanged is left
alone, and a changed one is updated in place. Everything the engine serves at
runtime is then read back from that table, never from disk.

Each connector a step declares names the adapter it calls with `id`, and what that adapter
does with `type` — one of `kyc`, `kyb`, `aml`, `credit`, `phone_verification`, `email_verification`,
`email_delivery`, `sms_delivery`, `bank_verification`, `payment`, `e_signature`,
`document_storage` and `custom`.
Two providers of the same capability share a value, so several workflows calling different email
providers all say `email_delivery`. A `type` that disagrees with the registered adapter fails at
startup. The definition itself carries no type: a workflow is classified by the connectors it
calls, and some call none.

A workflow is addressed by its `id` and its `version`. Starting an onboarding
without an explicit version picks the highest stored version of that `id`;
existing onboardings stay pinned to the version they were created with, so
publishing a new revision means adding a file with the same `id` and a higher
`version` rather than editing the old one in place.
