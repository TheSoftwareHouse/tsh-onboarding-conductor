---
description: Full feature pipeline — plan, implement, adversarially review, verify, document, commit
argument-hint: <what to build, or a path to a spec file>
---

Ship this, end to end: **$ARGUMENTS**

You are the orchestrator. You implement the code yourself — do not delegate implementation, because you
will be fixing review findings later and need the context. You delegate _judgement_: planning to an
agent that cannot edit, and review to agents that did not write the code.

**Four gates. At each one you stop, present, and wait for my answer. Do not continue past a gate on an
assumption about what I would say.**

---

## Stage 1 — Plan

Delegate to the `feature-architect` subagent, passing the task and any spec file involved. It is
read-only by design; do not write code while waiting for it.

**GATE 1.** Present the plan, then ask whether to proceed, revise, or stop. Surface every open question
the architect raised — those are for me, not for you to resolve. If I ask for revisions, send them back
to the same agent rather than re-planning yourself.

## Stage 2 — Implement

Work the approved plan, step by step, in the repository's own idiom.

Read the package `CLAUDE.md` for each package you touch before editing it — a package file may override
a global rule, and the most specific one wins. Follow the plan; if reality contradicts it, say so and
stop rather than silently improvising a different design.

As you go: `pnpm format:fix` after changes, and keep `docs/IMPLEMENTATION.md` in mind for stage 5 —
which sections you are invalidating.

## Stage 3 — Review, then refute the findings

**Every lens runs in its own subagent.** Do not invoke a review skill yourself: a skill loads its
instructions into _your_ context, and you just wrote this code — you would be reviewing your own work
carrying every rationalisation you formed while writing it. A fresh subagent has none of that, which is
the only reason this stage is worth its cost. The three lenses are subagents, always:

- `convention-reviewer` — this project's rules
- `correctness-reviewer` — bugs and simplification (wraps the `code-review` skill internally)
- `security-reviewer` — this engine's attack surfaces (wraps the `security-review` skill internally)

Spawn all three **in a single message** so they run concurrently. Each reads the pending diff itself and
returns findings; none of them may edit a file, and none may pass `--fix` or `--comment` to a skill —
that would modify the tree or post outward, bypassing the gate below.

Then verify what came back:

- Deduplicate first. Three lenses often report one underlying defect; merge those into a single finding
  before spending anything on verification.
- Send each finding to a `finding-verifier` subagent, concurrently, one per finding. **Skip findings
  that already arrive marked `CONFIRMED`** — the `code-review` skill runs its own verification pass at
  higher effort levels, and stacking a second refutation gate on an already-verified finding biases
  toward discarding real ones. Verify anything `PLAUSIBLE` or unmarked.
- Drop what the verifier refutes. Keep its reasoning — you need to report how noisy the reviewers were.

**GATE 2.** Present the surviving findings — severity, file and line, the concrete failure, and what the
fix would be. State how many were refuted and why, and how many arrived pre-confirmed and skipped
verification, so I can judge whether the panel is earning its keep. Ask which to fix. Fix only what I
pick.

## Stage 4 — Verify

Run the `/verify` sequence: `pnpm format:fix` → `pnpm lint` → `pnpm typecheck` → `pnpm build` →
`pnpm test:cov`, then `pnpm test:e2e` if the change touches the engine, a connector, a migration, or the
compose stack. Never call `jest`, `playwright`, `prettier` or `docker compose` directly.

Fix failures and restart the sequence from the top. Do not weaken a test or add an `eslint-disable` to
get through — if that looks like the only route, stop and explain the trade-off. Report the result
honestly, with output, including anything you skipped and why.

## Stage 5 — Document

- Update `docs/IMPLEMENTATION.md` per its §0 update map. It must describe the current state of the app
  at all times, so this is part of the change, not a follow-up.
- If a spec file drove this work, fold its substance in and **delete it**, saying what it covered. Keep
  it only if part of it is still unbuilt, and state exactly what remains.
- If the change makes any instruction file stale, name the file and section and **propose** replacement
  text for both the `CLAUDE.md` and its `.github/` mirror. Never edit an instruction file here.
- Add a changeset (`pnpm changeset`) only if a package's behaviour changed; docs-and-tooling-only changes
  in this repo carry none.
- Re-run `pnpm format:fix` after the doc edits.

**GATE 3.** Summarise what was built, what the reviewers caught, what verification passed, and what you
documented. Ask whether to commit.

## Stage 6 — Commit

On approval: create a branch if we are on `main` — `feat/`, `fix/` or `chore/` plus a kebab-case slug,
matching the repo's convention. Commit in Conventional Commits form, with a body explaining _why_, and
no `(#NN)` suffix (those come from the squash merge). The Husky pre-commit hook runs ESLint and Prettier;
if it fails, fix the cause rather than bypassing it.

**GATE 4.** Never push and never open a PR without asking. Report the branch and commit, and ask.

---

Scale to the task. A one-file change does not need six stages of ceremony — say so at gate 1 and offer
to do it directly instead. Ceremony proportional to risk is the point; ceremony for its own sake wastes
my time and your tokens.
