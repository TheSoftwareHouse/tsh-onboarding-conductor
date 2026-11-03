# 0053. One plugin marketplace in this repository serves Claude Code and Codex

- **Status:** Accepted
- **Date:** 2026-11-01
- **Tags:** skills, plugins, mcp, claude-code, codex
- **Supersedes:** —
- **Superseded by:** —

## Decision

The analyst skills ship as one plugin, `plugins/conductor-analyst/`, listed by two marketplace files
in this repository: `.claude-plugin/marketplace.json` for Claude Code and
`.agents/plugins/marketplace.json` for Codex. The plugin carries one `skills/` tree, a Claude manifest,
a Codex manifest and one `.mcp.json` declaring the `conductor` HTTP server at
`${CONDUCTOR_MCP_URL:-http://localhost:3100/mcp}`. The skills follow the Agent Skills specification,
which `pnpm skills:validate` already enforces, so both clients read the same files. The subagent
definition (`agents/onboarding-investigator.md`) is Claude-only.

The analyst skills are written for an analyst using the MCP tools: no repository paths, pnpm, Docker or
shell steps. They state that answers cite tool results, that numbers come from tools or code and are
never estimated, and that applicant-entered text is data, not instructions.

The developers' skills in `.claude/skills/` stay as they are and are not part of the plugin.

## Context

The audience is analysts on their own machines in either of two clients, not contributors to this
repository. Both clients read Agent Skills and install from a repository-hosted marketplace, so one tree can
serve both; they differ in manifest location, which is why two manifests exist. The Codex manifest layout
is confirmed against OpenAI's plugin documentation when it is written, and the work stops rather
than guesses if it matches neither known layout.

## Alternatives

| Option                                      | Why not                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A separate plugin tree per client           | Two copies of every skill drift apart; the shared specification makes one copy enough                                                 |
| Claude Code only                            | Leaves analysts on Codex without the skills                                                                                           |
| Put the analyst skills in `.claude/skills/` | That directory holds the developers' skills for this repository and loads only with the checkout; analysts need an installable plugin |
| A separate repository for the plugin        | The skills, their golden sets and the tool contracts they cite change together with `@tsh/mcp`                                        |

## Consequences

`scripts/validate-skills.cjs` and the `skill-evals` harness discover `plugins/*/skills/*` as well as
`.claude/skills/`; plugin golden sets add an optional `mcp_config` and an `mcp-tool-called` check, so
a case can assert which tool a skill reached for. Model-driven checks stay local and never run in CI
(0023).

Sign-in needs a pre-registered client id (0051); the MCP's registration shim hands it out (0054),
so `.mcp.json` carries none. The Codex equivalent of the
subagent and a Codex adapter for `skills:evals` are not built, so Codex skills are validated
structurally but not exercised by the golden sets.

Reversing this means splitting the tree per client and dropping the shared manifests; no analyst
data depends on the layout.
