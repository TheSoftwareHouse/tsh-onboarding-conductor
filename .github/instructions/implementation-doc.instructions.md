---
name: As-Built Documentation Conventions
description: Keeping docs/IMPLEMENTATION.md in step with the code as features land.
applyTo: packages/**/*.ts
---

- `docs/IMPLEMENTATION.md` is the as-built specification: it describes what exists in this
  codebase, and it is the starting point for anyone continuing development. `SPEC.md` in the
  separate specifications repository is the original design input, not a description of the build.
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
- Unlike `.github/copilot-instructions.md` and the other files in this directory, which are
  human-governed and changed only after explicit confirmation, `docs/IMPLEMENTATION.md` is expected
  to be updated directly alongside the code it describes.
