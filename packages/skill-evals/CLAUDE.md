# @tsh/skill-evals

Golden-set evaluation of the skills under `.claude/skills/`. Each case is a prompt a person would
type, what a human expects to come out, deterministic checks on the repository copy the agent worked
in, and assertions a judge grades with evidence. The agent is headless Claude Code with the skill
installed — the thing that actually consumes a `SKILL.md` — and the judge is one tool-less Claude
call. `docs/IMPLEMENTATION.md` §13 ("Golden sets") describes the whole loop; this file orients
within the package.

## Where things are

- `src/main.ts` — the command (`pnpm skills:evals`); `src/cli.ts` owns every flag and default.
- `src/golden-set.ts` — the `evals.json` format and its validation. Unknown keys fail. Read this
  before adding a case or a check type.
- `src/checks.ts` — the deterministic checks; `src/graph.ts` the name-free compile signature the
  `compiled-graph-matches` check compares.
- `src/judge.ts` — the rubric, the JSON schema the harness validates the verdict against, and the
  parsing of what comes back.
- `src/evaluate.ts` — one run: sandbox, agent, checks, judge, and the record of what the agent did.
  `src/report.ts` — the aggregate, the Markdown and the console lines; `src/markdown.ts` the
  fencing it and the judge prompt share.
- `src/runner.ts`, `src/glob.ts` and `src/reminder.ts` — typed bridges to
  `scripts/skill-eval-runner.cjs`, `scripts/validate-skills.cjs` and
  `scripts/skill-evals-reminder.cjs`, which stay CommonJS under `scripts/` because
  `skills:routing`, `skills:ablation` and Claude Code's hooks use them without this package.
- Golden sets live with their skill: `.claude/skills/<skill>/evals/evals.json`, with `golden/` for
  reference artifacts and answers and `files/` for inputs a case places into the sandbox.

## Pitfalls

- **Anything under `evals/` is deleted from the sandbox before the agent starts.** The golden answers
  would otherwise be readable by the model under test. `prepareSandbox` strips every skill's `evals/`
  and commits, so those deletions never show up as the agent's changes either.
- **Changes are measured against the sandbox's baseline commit, not `git status`.** `prepareSandbox`
  returns the commit it made and `collectChangedFiles` diffs the working tree against it, adding
  the untracked files, so an agent that commits its work — the workflow skill talks about
  publishing — is still graded on it. On `git status` alone such a run shows the judge "(none)" for
  its files and fails every file check for a reason that is not the skill's.
- **A run that did not pass carries its own evidence.** Under its verdict the report lists the files
  git saw changed, every tool call with the file, command or query it was aimed at (a path outside
  the sandbox is marked as such), the final message and the harness's exit code, result and stderr;
  the console prints the failed checks and assertions under the case line as it finishes. Read that
  record before changing the skill: a `Write` to a path the glob does not match, a `git stash`, or
  a run that never got to write anything each read as a failed check and are not the skill's fault.
- **A run the harness or the judge did not finish is `errored`, not failed.** So is one whose sandbox
  could not be made or prepared. It is excluded from the pass rate and keeps its sandbox; a case with
  no graded run fails, and the rest of the suite goes on. Grading an empty sandbox as "the model got
  it wrong" would move the number this suite exists to measure.
- **The judge call is cheap only because of two flags.** `--strict-mcp-config` drops the MCP servers
  the machine has configured (tens of thousands of tokens per call on a developer machine) and
  `--disable-slash-commands` the skill descriptions; the agent run also drops MCP servers, so no
  eval can act on a connector a developer attached to their own Claude Code.
- **The DDL is loaded lazily from its `dist`.** `main.ts` builds `@tsh/ddl-schema` before any check
  runs; the specs map the package to its source instead (`jest.config.cjs`), so `pnpm test` needs no
  build.
- **`skill_name` must equal the directory the file sits in**, and a case with `judge: false` may
  carry no assertions — the judge is what grades them.
- **A set or a case may declare `"model"`.** It names the agent model the case needs, and beats the
  command line's `--model`, which is only the default for cases that declare none; `--override-model`
  beats both. The BFF set and the `fixture-consent-review` case declare `sonnet`: with the skill in
  front of it, Haiku still called the upload conflict an expired URL, dropped the never-relay rule,
  and built the consent fixture as a `connector-call` with an invented connector id, so on the
  default `haiku` those cases would be red for a reason that is not the skill's.
- **A case invokes its skill explicitly unless it says `"invocation": "natural"`.** The prompt is
  sent as `/<skill> <prompt>`, the skill loads by construction, and a `skill-fired` check on such a
  case says nothing. On `haiku` a bare prompt seldom reaches for a skill at all, so a natural case
  measures routing, which is `skills:routing`'s job — write one only for a skill that must _not_
  fire. Never write the slash prefix into the prompt yourself; the loader refuses it. Scope such a
  case's other checks to what a **misfire** would leave behind — `negative-e2e-containers` bounds
  `workflows/**` and `packages/demo-bff/**` rather than `**`, because with no skill loaded what the
  agent does next is base-agent behaviour no `SKILL.md` can move, and asserting it makes the case a
  coin flip.
- **Two invocations at once no longer collide, and older reports may show where they did.** Each
  process gets its own `$TMPDIR/tsh-skill-eval/run-<pid>-<time>/` tree (`createSandbox` in
  `scripts/skill-eval-runner.cjs`). Before that the sandbox path was the case label alone, so a
  second `skills:evals` — or an `skills:ablation` — running beside the first deleted its sandbox
  mid-run; the victim errored with `fatal: bad object <sha>` from `collectChangedFiles`, or with a
  judge that got no output, and the case failed with no graded run. An errored run naming a sandbox
  someone else was using is that, not the skill.
- **A run takes one to five minutes and the whole suite about ten.** The console prints a line when
  a run starts, one a minute naming what is still in flight, and one when a case finishes; the
  report is rewritten after every finished case. `Ctrl+C` stops the agents in flight, removes their
  sandboxes (`--keep-sandbox` keeps them) and leaves the partial report, marked as such.
- **Reports are never committed, so they prove nothing about what was run.** `reports/` is
  gitignored, and every run writes a fresh timestamped directory; nothing downstream reads them.
  `report.json` carries what the Markdown shortens, `--print-report` ends the run with the whole
  Markdown in the terminal, and the verdict belongs in the pull request, written by the person who
  ran it.
- **This command runs on one machine and one account.** `skills:evals` exits 2 when `CI` or
  `GITHUB_ACTIONS` is set, and `localAccountEnv` in `scripts/skill-eval-runner.cjs` deletes every
  credential variable that would route a run elsewhere — a key, an auth token, a base-URL override,
  the Bedrock and Vertex switches — from every `claude` child, naming them once on the console. The agent and the judge
  therefore always authenticate as the signed-in Claude Code account. There is no workflow, and
  adding one would contradict [0023](../../docs/decisions/0023-skill-golden-sets-run-claude-code-headless.md).
- **The hooks that ask for a run are switched off inside a sandbox.** `.claude/settings.json` wires
  `scripts/skill-evals-reminder.cjs` to `PostToolUse` and `Stop`; a copy of that settings file
  travels into every sandbox, so `createSandbox` deletes its `hooks` key and `runClaude` sets
  `SKILL_EVALS_SANDBOX=1`, which the script honours on its own. Without both, the agent under test
  would be told to evaluate the skill it is being measured on — and the `Stop` hook would keep it
  from ever finishing.

## Commands

| Command                                     | Does                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm skills:evals`                         | Every case, one run each, `haiku` agent and judge; exit 1 when a case fails      |
| `pnpm skills:evals --validate`              | Check the golden sets and compile their artifacts; no model, no spend            |
| `pnpm skills:evals --dry-run`               | Print the plan and spend nothing                                                 |
| `pnpm skills:evals --case <text> --runs 3`  | One case, three runs — the way to tell a coin flip from a real gap               |
| `pnpm skills:evals --model sonnet`          | Default for cases that declare no model; `SKILL_EVALS_AGENT_MODEL` sets the same |
| `pnpm skills:evals --override-model sonnet` | Every case on one model, whatever the golden sets declare                        |
| `pnpm skills:evals --keep-sandbox`          | Leave every sandbox under `$TMPDIR/tsh-skill-eval/` for inspection               |
| `pnpm skills:evals --print-report`          | The whole Markdown report on stdout when the run ends                            |
| `pnpm --filter @tsh/skill-evals test`       | The unit tests, including a check of every committed golden set                  |

Credentials: the signed-in Claude Code account, and nothing else — see the pitfall above. A run
needs `claude` on the PATH and a Claude account signed in to it; it takes no key and accepts none.
