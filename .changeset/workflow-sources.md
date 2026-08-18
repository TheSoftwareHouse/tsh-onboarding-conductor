---
'@tsh/engine': minor
---

Split workflows into three explicit sources: built-in, user and fixtures.

The repository root `workflows/` directory served every role at once — checked-in examples, the Compose mount source, and the fixture set every e2e suite pointed `WORKFLOWS_DIR` at. None of those files were production workflows: each demonstrates one connector or engine feature, `http-request.workflow.json` posts to the reserved placeholder host `api.example.com`, and `sendgrid-email.workflow.json` has no failure branch.

`WorkflowRegistryService` now loads and merges three sources:

| Source       | Setting                 | Loaded in          | May be empty |
| ------------ | ----------------------- | ------------------ | ------------ |
| **built-in** | `BUILTIN_WORKFLOWS_DIR` | all environments   | yes          |
| **user**     | `WORKFLOWS_DIR`         | all environments   | no, if set   |
| **fixtures** | `FIXTURE_WORKFLOWS_DIR` | development & test | no, if set   |

- Built-in workflows ship inside the engine image at `packages/engine/workflows/built-in`. The directory is currently empty and is the one source allowed to be absent or hold nothing.
- All previously checked-in workflows are fixtures, now at `packages/engine/workflows/fixtures`. `AppConfig` throws when `FIXTURE_WORKFLOWS_DIR` is set under `NODE_ENV=production`.
- A workflow ID claimed by two sources fails startup and names both sources. A duplicate within one directory keeps its existing `WORKFLOW_INVALID` error.
- Startup fails with `NoWorkflowsConfiguredError` when the three sources between them produce nothing.

**Breaking:** `WORKFLOWS_DIR` is no longer required — an engine can run on built-in workflows alone — so a deployment that relied on validation rejecting a missing value will now start. It is still rejected when set to a blank string.

**Fix:** `smtp_email` resolved a connector `templatePath` against `WORKFLOWS_DIR` only, which now breaks for a workflow from any other source. It resolves against each configured source in turn, and refuses a path that escapes the source directory — previously `resolve()` was used with no containment check, so `../../etc/passwd` in a workflow definition was readable.
