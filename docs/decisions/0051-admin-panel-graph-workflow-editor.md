# 0051. The admin panel edits a draft's authored document on a canvas

- **Status:** Accepted
- **Date:** 2026-10-23
- **Tags:** admin-panel, frontend, workflows, authoring, ddl-schema, forms
- **Supersedes:** —
- **Superseded by:** —

## Decision

The admin panel's draft editor gains a canvas tab, and the canvas edits the draft's **authored**
document directly. There is no separate graph model, and nothing is decompiled.

**Mapping.**

- A node is an authored step.
- An edge is a wired port (`edges.<port>`).
- The palette offers every step type the registry has.
- A step's position is stored in its `meta.position`. `meta` is free-form, carried and never read
  by the engine. Saving writes the same document the JSON tab edits, through the existing `PUT`.

**Layout and editing.**

- The first layout is dagre, which is already a dependency. A per-rank pass places each step
  under the port that leads to it.
- Edges are routed by the panel's own orthogonal router. Runs sit in the gaps between rows, lanes
  outside the graph nest by length, and retry loops keep to the right.
- Once any step has a stored position, every canvas edit stores one for every step, so undo never
  mixes stored and laid-out spots. Auto-arrange lays the graph out again and stores the result when
  the document had positions; a document with none stays without.

**What the canvas shows from the compiler.** For each step, as it is edited:

- the ports it has;
- the fields it stores, sub-steps included;
- the fields two steps both create.

These come from ddl-schema's own per-step compile, which runs in the browser.

- The compiler's ajv-free per-step part lives in `step-types/step-compile.ts`.
  `workflow.compiler.ts` calls it, and so does the panel. The two cannot drift apart.
- The panel reads it through two new subpaths, named for what they hold:
  - `@tsh/ddl-schema/step-types`: the registry, ports, categories, step naming, presets and the
    per-step compile;
  - `@tsh/ddl-schema/workflow-schema`: the authored document's JSON Schema.
- Every ddl-schema subpath except the package root and `workflow-validator` stays free of runtime
  dependencies. A ddl-schema spec enforces this.

**The panel's import rule is replaced.**

- The panel may import `@tsh/ddl-schema/workflow-contract`, `step-types` and `workflow-schema`.
- It may not import `@tsh/engine`, the ddl-schema root, or any other ddl-schema path.
- An ESLint `no-restricted-imports` rule in the panel enforces this, replacing the prose in
  `packages/admin-panel/CLAUDE.md`.

**Inspector forms.** The step inspector's config forms are generated from each step type's JSON
Schema and write straight into the document. They do not use react-hook-form. This is an exception
to [0019](./0019-react-hook-form-for-admin-panel-forms.md) for the canvas only: the document is the
one source of truth, and undo and redo work on it.

## Context

Operators author drafts as JSON ([0034](./0034-admin-authored-workflow-drafts.md)). The visual editor
was always meant to produce the same document. [0011](./0011-typed-steps-are-the-authored-form.md)
makes typed steps the only authored form. The compiled form is what the engine runs, and turning it
back into steps loses information. So the canvas has to work on authored steps, and save them the
way the JSON tab does.

The canvas needs a step's ports and fields on every edit, and for most step types they depend on the
step's config: adding a decision branch adds a port. Drafts are usually invalid while they are being
built, so this has to keep working when some other step is broken.

`GET /v1/admin/step-types` documents that it cannot list ports for this reason.
`POST /v1/admin/workflows/compile` stops at the first failure.

**Where the old import rule came from.** The panel's "talks to `@tsh/engine` over HTTP only" rule
was not a recorded decision.

- It appeared in the first `packages/admin-panel/CLAUDE.md` (`86bc57e7`, 2026-08-21), describing
  the panel as it was then.
- `3b654d05` (2026-08-31) carved out `workflow-contract`. The only reason given was keeping `ajv`
  out of the browser bundle.
- [0004](./0004-admin-panel-served-by-the-engine.md) has the engine serve the panel from its own
  image. The panel and ddl-schema therefore always come from the same build and cannot drift.

The approach was tried in throwaway prototypes between 2026-10-14 and 2026-10-23, on branch
`feature/graphic-create-workflow-prototype`, and chosen with the user on 2026-10-23.

## Alternatives

| Option                                                         | Why not                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A separate graph model, exported to JSON                       | Two models to keep in step. The authored document already is a graph: steps and wired ports                                                                                                                                                                                                                                                                          |
| Edit the compiled form and decompile it                        | Decompiling loses information, and 0011 makes typed steps the only authored form                                                                                                                                                                                                                                                                                     |
| ELK for layout and routing                                     | It was tried twice. Once tuned, it matched our layout with fewer bends, but only with three settings: cycle breaking by a topological order from `initial` (`MODEL_ORDER`), one entry port per incoming edge, and `NETWORK_SIMPLEX` with straightness priority on the main path. Its routes go stale as soon as a step is dragged, which an editor does all the time |
| An engine preview endpoint, with `/step-types` for the palette | Every edit costs a round trip, so ports lag behind config edits, and the canvas needs loading and error states. It needs a new route, DTO and OpenAPI change. The panel's fake-engine e2e fixture would have to produce compiler output                                                                                                                              |
| A panel-side copy of the per-step compile                      | The prototype's 130-line copy, which would drift from `workflow.compiler.ts`                                                                                                                                                                                                                                                                                         |
| Keep the "HTTP only" prose rule                                | It has no recorded rationale beyond `ajv` in the bundle, which the runtime-dependency spec covers. It forces copies of domain lists, such as the onboarding statuses (IMPLEMENTATION.md §12)                                                                                                                                                                         |
| react-hook-form per inspector section                          | Two sources of truth, the form state and the document, kept in sync on every edit, undo and redo                                                                                                                                                                                                                                                                     |

## Consequences

**ddl-schema.**

- Its per-step compile is now shared code: a change there changes both the engine's compile and the
  panel's preview.
- `workflow.compiler.spec.ts` keeps guarding the engine's behaviour.
- A new subpath must stay free of runtime dependencies, unless it is added to the spec's exceptions
  on purpose.

**The bundle.** The panel's bundle now includes the step registry and the per-step compile. Their
built size has not been measured.

**The panel.**

- Lists the panel copies today can move to imports under the new rule. The onboarding statuses are
  a follow-up.
- Positions live in `meta.position`, so a hand-written `meta` key named `position` on a step is
  overwritten when that step is moved on the canvas.
- The canvas forms do not get react-hook-form's dirty or touched state. The document's own
  dirtiness drives the unsaved-changes guard ([0050](./0050-admin-panel-data-router.md)).

**Reverting.**

- Reverting the canvas leaves the JSON tab working as before.
- Reverting the import rule means restoring the prose and moving the editor's ddl-schema use behind
  an endpoint.

**0019.** This record amends 0019 for the graph editor's inspector forms only. 0019's "Superseded by"
line links here.
