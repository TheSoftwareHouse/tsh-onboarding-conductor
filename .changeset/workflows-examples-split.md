---
'@tsh/engine': minor
---

Separate shipped workflow examples from engine test fixtures.

The repository root `workflows/` directory served three roles at once: checked-in examples, the Compose mount source, and the fixture set every e2e suite pointed `WORKFLOWS_DIR` at. An example could not be changed without risking the e2e suite, and none of the files were production workflows to begin with — each demonstrates a single connector or engine feature.

- `workflows/` moved to `examples/workflows/`, with a README documenting what each example demonstrates and which connector tier it depends on.
- The engine e2e and unit suites now read their own frozen copy at `packages/engine/test/fixtures/workflows/`.
- Compose mounts `./examples/workflows` at the unchanged container path `/app/workflows`; `WORKFLOWS_DIR` in `.env.dist` now points at `./examples/workflows`.

One guard still loads `examples/workflows/` on purpose: `WorkflowRegistryService` unit tests assert the shipped examples stay valid against the real adapters.
