# 0023. Skill golden sets run headless Claude Code as the system under test and a Claude judge

- **Status:** Accepted
- **Date:** 2026-09-18
- **Tags:** skills, testing, ci, claude-code, evaluation
- **Supersedes:** —
- **Superseded by:** —

## Decision

The skills under `.claude/skills/` are tested against golden sets: for each case a prompt in a
person's words, an expected output a human wrote, deterministic checks on the resulting repository
copy, and assertions a judge grades with evidence. The system under test is headless Claude Code
(`claude -p`) with the skill installed, run in a throwaway copy of the repository with the golden
sets removed and every MCP server dropped, on Haiku 4.5 by default, on the model a golden set or a
case declares for itself (the BFF set and one workflow case declare Sonnet 5), and on any model per
run. The
judge is one tool-less `claude -p` call on Haiku 4.5 with the harness's system prompt replaced by
the rubric and the verdict validated against a JSON schema, so it costs under a cent and reuses the
harness's credentials. A case invokes its skill explicitly by default (`/<skill> <prompt>`), so it
measures the skill's content; whether the skill is reached for on a bare prompt is measured
separately (`skills:routing`, and `"invocation": "natural"` cases such as one that must not fire).
The objective facts — which skill fired, which files changed, whether a
workflow compiles and validates, whether its name-free compiled graph equals the golden's — are
decided by scripts and the DDL, never by the judge; the judge scores "same or close enough" against
the expected output and grades the assertions.

Golden sets live beside their skill in `.claude/skills/<skill>/evals/evals.json`, the Agent Skills
convention, with `golden/` and `files/` next to it. The tooling is a workspace package,
`packages/skill-evals`, with unit tests; `pnpm skills:evals` runs it.

**The suite runs only on the machine of whoever changed a skill, as that machine's signed-in Claude
Code account.** No GitHub Actions workflow runs it, `skills:evals` exits 2 when `CI` or
`GITHUB_ACTIONS` is set, and every credential variable that would route a run through the Anthropic
API, a gateway, Bedrock or Vertex is deleted from the `claude` child's environment and named on the
console rather than honoured — the list is `CREDENTIAL_ENVIRONMENT_VARIABLES` in
`scripts/skill-eval-runner.cjs`. The suite needs no secret because it accepts none, and the same
holds for `skills:routing` and `skills:ablation`, which share that runner.

What makes a local check reliable is that the harness asks for it rather than a person remembering:
`scripts/skill-evals-reminder.cjs`, wired in `.claude/settings.json` as a `PostToolUse` hook on
edits and a `Stop` hook before a turn ends. The `Stop` hook decides from `git status --porcelain`
under `.claude/skills/` and a hash of the changed files' content — reports are gitignored and say
nothing about which state of which skill was graded — and blocks once per state, naming
`pnpm skills:evals --case <skill>`. A further edit earns another reminder; a rerun of the suite,
which changes nothing tracked, does not. Inside an eval sandbox both hooks are off, by the copied
settings losing their `hooks` key and by `SKILL_EVALS_SANDBOX` in the child's environment.

## Context

The repository already measured two things about its skills without a model (`skills:validate`)
and with one (`skills:routing`, `skills:ablation`), but nothing said whether a given prompt still
produced an acceptable result after a skill changed, and neither model-driven check ran in CI. The
suite exercises the real skill through the real harness and uses a model only as the judge,
scoring an actual answer against an expected one on a 0–100 scale with a threshold. These
constraints shaped the design:

- A SKILL.md is consumed by Claude Code, so a faithful test has to run Claude Code. Feeding the
  skill's text to another model with no tools would test different prose on a different model, and
  the skills' own procedure (compile, validate, read registries) could not execute.
- Judging with a separate vendor was the brief's starting point, for cost. A first probe of a
  `claude -p` judge cost five cents because the developer's MCP connectors travelled with every call;
  with those and the skill descriptions excluded it cost 0.4 cents, which removed the reason for a
  second vendor, a second SDK and a second secret. Same-family leniency is bounded by leaving every
  objective check to scripts.
- Agent runs are the cost: tens of turns over a large context, tens of cents on Haiku and up to a
  few dollars on Sonnet per case. That, plus nondeterminism, keeps the suite out of every pipeline.
- The only account these runs should ever bill is the developer's own subscription, already signed
  in to the `claude` they are using. A workflow needs an organisation API key instead: a second
  credential to issue, store and rotate, a bill that grows with every pushed fixup, and a check
  whose red is as often a flaky judge as a broken skill. The suite is a tool for whoever is editing
  a skill, so it belongs where that editing happens — and if an API key is never accepted, no
  workflow can quietly be added later that works.
- A local check that depends on remembering is not a check. Claude Code runs hooks itself, so the
  reminder can be made a property of the repository rather than of anyone's discipline.
- The first two smoke runs, on Haiku with bare prompts, invoked neither skill: the model answered
  from `CLAUDE.md` and the code, and the checks and the judge failed the runs. A golden set that
  reaches the skill only when the model happens to route to it would measure routing on the
  cheapest model rather than the skill. The Agent Skills guide separates the two — output evals
  hand the agent the skill path, trigger evals count invocations on bare prompts — and so does this.

## Alternatives

| Option                                                                                         | Why not                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini as the judge                                                                            | A second vendor, SDK and secret for a call that costs under a cent either way; same-family bias is bounded by the script-decided checks                                                                                                                     |
| Gemini, or any non-Claude model, as the agent under test                                       | Tests prose on a model the skill is not written for, with no tool use, so the skills' compile/validate loop cannot run                                                                                                                                      |
| The Anthropic SDK for the judge instead of `claude -p`                                         | Needs an API key locally where Claude Code already holds a login; the CLI is already the dependency and reports exact cost                                                                                                                                  |
| Running the suite inside `ci.yml` on every pull request                                        | Attaches model spend and a nondeterministic verdict to every push                                                                                                                                                                                           |
| Its own workflow on skill-touching pull requests, weekly and on demand, on an organisation key | What this record said until 2026-09-18. It needs a key issued for work a developer's own signed-in account already covers, bills every fixup push, and leaves a flaky red check on pull requests; accepting no key at all is what keeps it from coming back |
| A line in `CLAUDE.md` asking for a run instead of a hook                                       | Prose reaches a session that reads it and a person who remembers it; a `PostToolUse` and a `Stop` hook reach every edit and every turn, and `CLAUDE.md` still carries the rule for the reader                                                               |
| A `pre-commit` hook running the suite                                                          | Minutes of model time on every commit of a skill, with no way to answer "not this one"; the reminder belongs where the work is being decided, not at the commit                                                                                             |
| Golden sets as one central file under `packages/`                                              | The Agent Skills convention puts `evals/` beside the skill, where a skill author edits it with the skill                                                                                                                                                    |
| Extending the ablation script with golden cases                                                | The ablation measures a with/without delta on `creating-workflows` only and has no reference artifact, no judge and no report anyone reads later                                                                                                            |
| Bare prompts for every case, Sonnet as the default agent                                       | Routes to skills more often, at three to five times the cost, and still folds routing into every verdict; `--model sonnet` remains one flag away                                                                                                            |
| Sonnet as the default agent for every case                                                     | Passes everything the smoke runs tried, at three to five times the cost of Haiku on the cases Haiku does pass; declaring the model where it is needed keeps the bill on the cases that need it                                                              |

## Consequences

- `.claude/skills/<skill>/evals/` is deleted from every sandbox before the agent starts, so a golden
  answer can never leak into the run; the runner commits that deletion so it is not graded as the
  agent's change.
- A run the harness or the judge did not finish is excluded from pass rates and keeps its sandbox;
  a case with no graded run fails. The pass rate is a measurement of the skill, not of the network.
- Results describe the machine they ran on, and every run is now on someone's own machine: the
  `tsh-*` plugins one developer has enabled offer the agent skills another's run would not, so two
  verdicts on the same case are not strictly comparable. The report names every skill that fired,
  which is what makes such a difference visible.
- Nothing reruns a case for a second opinion. The verdict reaches the team only if the person who
  changed the skill puts it in the pull request, and a skill changed by someone who ignores the
  reminder is merged ungraded. That is the price of taking the spend off the organisation and out
  of the pipeline.
- The `claude` CLI must be installed and signed in where the suite runs, which is a developer's own
  machine. Its version is printed with every run.
- Adding a case is data: an entry in `evals.json` plus golden files, validated by `pnpm test` and by
  lint-staged; adding a check type is code in `packages/skill-evals/src/checks.ts`.
- The default agent is the cheap model, and a set or case that the cheap model cannot pass with the
  skill in front of it declares a stronger one rather than lowering its bar. The BFF answer cases and
  the consent-fixture case do: Haiku contradicted the skill on them (a wrong explanation of the
  upload conflict, an invented connector id) where Sonnet followed it, so on Haiku they would measure
  the model rather than the skill. `--override-model` still runs everything on one model.

Reversing this is cheap: the package can be removed with the `evals/` directories, the reminder
hooks and `scripts/skill-evals-reminder.cjs`, and nothing else depends on them.
