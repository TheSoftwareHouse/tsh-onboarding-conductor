---
name: As-Built Documentation Conventions
description: Keeping docs/IMPLEMENTATION.md in step with the code as features land.
applyTo: packages/**/*.ts
---

- `docs/IMPLEMENTATION.md` is the as-built specification: it describes what exists in this
  codebase, and it is the single starting point for anyone continuing development. There is no
  external or historical specification for this system — do not look for one, cite one, or reason
  from one.
- `docs/IMPLEMENTATION.md` must describe the current state of the app at all times. Any change to the
  codebase is reflected there in the same change; there is no acceptable window in which the code and
  the document disagree.
- A spec document added to drive new work is a transient input, not a reference. When a `SPEC.md` (or
  any spec file) describing a feature to build appears in the repository: implement it, fold its
  substance into `docs/IMPLEMENTATION.md` in the same change, then delete the spec file and say so.
  Keep it only if part of what it describes is still unbuilt, and state exactly what remains.
- Whenever a feature is added, changed, or removed, update `docs/IMPLEMENTATION.md` as part of the
  same change. A merged feature that is not described there makes the document wrong, and a reader
  cannot tell which other parts have also gone stale.
- The document's section-by-section update map, and the rules for what belongs in it, live in its
  own section 0. Follow them; do not restate them here.
- Describe the present tense only. Roadmaps, planned work, recommendations, and unmerged branches
  do not belong in the as-built document. A feature behind a disabled flag is described as present
  and off by default.
- Every claim must be checkable against a named file. Do not carry a claim forward from an earlier
  revision without re-verifying it against the current code.
- State the reasoning behind a mechanism, not only the mechanism. That reasoning is the document's
  main value over reading the source.
- Record absences, unreachable code, and known rough edges plainly in the section that covers them.
- Unlike `.github/copilot-instructions.md`, the other files in this directory, and their `CLAUDE.md`
  mirrors, which are human-governed and changed only after explicit confirmation,
  `docs/IMPLEMENTATION.md` is expected to be updated directly alongside the code it describes.
