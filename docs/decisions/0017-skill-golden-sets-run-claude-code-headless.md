# 0017. Skill golden sets run headless Claude Code as the system under test and a Claude judge

- **Status:** Accepted
- **Date:** 2026-09-17
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
`packages/skill-evals`, with unit tests; `pnpm skills:evals` runs it. It has its own GitHub Actions
workflow — pull requests that touch a skill or the tooling, a weekly schedule, and manual dispatch —
and is never a required check of `ci.yml`. `ANTHROPIC_API_KEY` is the only secret.

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
  few dollars on Sonnet per case. That, plus nondeterminism, keeps the suite out of the required
  pipeline and puts it on the triggers where a skill can actually have changed.
- The first two smoke runs, on Haiku with bare prompts, invoked neither skill: the model answered
  from `CLAUDE.md` and the code, and the checks and the judge failed the runs. A golden set that
  reaches the skill only when the model happens to route to it would measure routing on the
  cheapest model rather than the skill. The Agent Skills guide separates the two — output evals
  hand the agent the skill path, trigger evals count invocations on bare prompts — and so does this.

## Alternatives

| Option                                                   | Why not                                                                                                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini as the judge                                      | A second vendor, SDK and secret for a call that costs under a cent either way; same-family bias is bounded by the script-decided checks                                                        |
| Gemini, or any non-Claude model, as the agent under test | Tests prose on a model the skill is not written for, with no tool use, so the skills' compile/validate loop cannot run                                                                         |
| The Anthropic SDK for the judge instead of `claude -p`   | Needs an API key locally where Claude Code already holds a login; the CLI is already the dependency and reports exact cost                                                                     |
| Running the suite inside `ci.yml` on every pull request  | Attaches model spend and a nondeterministic verdict to every push                                                                                                                              |
| Golden sets as one central file under `packages/`        | The Agent Skills convention puts `evals/` beside the skill, where a skill author edits it with the skill                                                                                       |
| Extending the ablation script with golden cases          | The ablation measures a with/without delta on `creating-workflows` only and has no reference artifact, no judge and no report anyone reads later                                               |
| Bare prompts for every case, Sonnet as the default agent | Routes to skills more often, at three to five times the cost, and still folds routing into every verdict; `--model sonnet` remains one flag away                                               |
| Sonnet as the default agent for every case               | Passes everything the smoke runs tried, at three to five times the cost of Haiku on the cases Haiku does pass; declaring the model where it is needed keeps the bill on the cases that need it |

## Consequences

- `.claude/skills/<skill>/evals/` is deleted from every sandbox before the agent starts, so a golden
  answer can never leak into the run; the runner commits that deletion so it is not graded as the
  agent's change.
- A run the harness or the judge did not finish is excluded from pass rates and keeps its sandbox;
  a case with no graded run fails. The pass rate is a measurement of the skill, not of the network.
- Results describe the machine they ran on: a developer machine with the `tsh-*` plugins enabled
  offers the agent skills CI does not have. The report names every skill that fired.
- The `claude` CLI must be installed where the suite runs; the workflow installs it. Its version is
  printed with every run.
- Adding a case is data: an entry in `evals.json` plus golden files, validated by `pnpm test` and by
  lint-staged; adding a check type is code in `packages/skill-evals/src/checks.ts`.
- The default agent is the cheap model, and a set or case that the cheap model cannot pass with the
  skill in front of it declares a stronger one rather than lowering its bar. The BFF answer cases and
  the consent-fixture case do: Haiku contradicted the skill on them (a wrong explanation of the
  upload conflict, an invented connector id) where Sonnet followed it, so on Haiku they would measure
  the model rather than the skill. `--override-model` still runs everything on one model.

Reversing this is cheap: the package can be removed with its workflow and the `evals/` directories,
and nothing else depends on them.
