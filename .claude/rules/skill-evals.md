---
paths:
  - '.claude/skills/**/*.md'
  - '.claude/skills/**/evals/**'
---

# Changing a skill

A skill under `.claude/skills/` is graded by its golden set, and the golden sets run **only here,
on this machine, on the signed-in Claude Code account**. No workflow runs them: `skills:evals`
refuses to start when `CI` or `GITHUB_ACTIONS` is set, and every credential variable that would
route a run through the API, a gateway, Bedrock or Vertex is dropped before the `claude` child
starts. Never add a workflow, a step or a secret that runs them.

- After changing a skill — its `SKILL.md`, a reference document, or its `evals/` — run
  `pnpm skills:evals --case <skill>` and report the verdict. Run the whole suite,
  `pnpm skills:evals`, before opening a pull request.
- A case takes one to five minutes and the whole suite about ten. If the user would rather not
  spend a run on a change, say so rather than skipping it silently.
- `pnpm skills:evals --validate` checks every golden set and compiles its artifacts without a
  model. It is free, it runs in lint-staged for staged files under `evals/` and as a unit test, and
  it is not a substitute for a run — it says the set is well-formed, never that the skill still
  produces the right answer.
- `.claude/settings.json` wires `scripts/skill-evals-reminder.cjs` to the `PostToolUse` and `Stop`
  hooks, so an edit to a skill and the end of a turn both ask for the run. The `Stop` hook reads
  `git status` under `.claude/skills/` — reports are gitignored and prove nothing — and blocks once
  per state, so it never loops.
- `packages/skill-evals/CLAUDE.md` is the package's own guide: the `evals.json` format, the check
  types, and why a case declares its own model.
