---
id: trying-it-locally
title: Trying it locally
sidebar_label: Trying it locally
description: Run the MCP server and a seeded population of synthetic onboardings on a laptop, then investigate them from Claude Code, Codex or the MCP Inspector.
---

→ Two commands give you the engine, the MCP server and 46 synthetic onboardings that each end in a known state, with sign-in switched off and no real personal data. Ask the assistant about them, or call the tools by hand with the Inspector.

## Start the stack and seed it

From the repository root, with `.env` copied from `.env.dist` and Docker running:

```bash
pnpm stack:mcp:up        # the stack plus the MCP server, on http://localhost:3100/mcp
pnpm onboardings:seed    # runs real onboardings through the engine's public API
```

`pnpm stack:mcp:up` adds the MCP server to what [`pnpm stack:up`](../getting-started.md) starts. `MCP_PORT` in `.env` changes the published port. The engine stays on `http://localhost:3000`.

The seeder drives the [`analyst-investigation`](/fixtures/analyst-investigation) workflow through start, submit, upload, provider callback and review, so every transition, score and audit row is the engine's own. `--count` sets how many onboardings end approved (default 8); every other scenario family has a fixed size. With the defaults, including seed 42, that makes 46 onboardings. Everything is deterministic: the same seed produces the same applicants and the same scenarios. The onboarding ids are random on each run.

To give date and funnel questions some shape, spread the onboardings over the last 90 days:

```bash
pnpm onboardings:seed -- --spread-days 90
```

:::warning The spread rewrites timestamps
`--spread-days` rewrites `created_at`, `updated_at`, `completed_at` and the matching audit times in the database. It refuses any host other than `localhost`, `127.0.0.1` and `postgres`.
:::

## Read the manifest

The seeder writes `packages/onboarding-seeder/out/manifest.json` (gitignored). Each scenario has a key, the onboarding id, the status and step it should be in, whether it is parked, and the answer an investigation should reach:

| Family                                                 | Count  | What it shows                                                |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------ |
| `approved`                                             | 8      | Passed every step                                            |
| `score-reject`                                         | 4      | Rejected on the risk score at `collect_profile`              |
| `verdict-reject`                                       | 3      | Rejected by the identity provider's verdict, with a reason   |
| `review-waiting`                                       | 4      | Waiting in manual review; with a spread, some are months old |
| `review-approved`, `review-rejected`, `review-invalid` | 2 each | Closed by a reviewer                                         |
| `parked-awaiting`                                      | 4      | Parked at `check_identity`, no provider callback yet         |
| `parked-completed`                                     | 2      | Parked, then the callback arrived                            |
| `otp-exhausted`                                        | 2      | Five wrong email codes                                       |
| `abandoned-<step>`                                     | 11     | Applicant stopped at one of five steps                       |
| `duplicate-applicant`                                  | 2      | Two onboardings with the same email                          |

The expected answer for `score-reject-03`, copied from the manifest:

```text
rejected at collect_profile: risk 90 ≥ 60 (country TR +40, PEP +30, source of funds sale_of_asset +20)
```

## Ask the assistant

Install the plugin as in [Connecting Claude Code or Codex](./connecting.md); the defaults point at this local server. Then ask, using an id from the manifest:

- "Why was onboarding `<id of score-reject-03>` rejected?" Expect the step, the score of 90 against the threshold of 60, and the three rules that fired.
- "What is waiting in manual review, oldest first?" Expect the four `review-waiting` onboardings.
- "Which onboardings are parked on a provider, and for how long?" Expect the four `parked-awaiting` onboardings.
- "Do `<id of duplicate-applicant-01>` and `<id of duplicate-applicant-02>` share an applicant?" Expect one shared email pseudonym and two different phone pseudonyms.
- "How many onboardings ended in each status?" Expect the counts below.

If the assistant's answer differs from the manifest's `explanation`, trust the manifest and look at which tool result it misread.

## Call the tools by hand

`pnpm mcp:inspect` opens the MCP Inspector's web interface against the local server. The Inspector also has a command-line mode; these calls were run against the stack above:

```bash
pnpm --filter @tsh/mcp exec mcp-inspector --cli http://localhost:3100/mcp --transport http \
  --method tools/list
```

The list holds 16 tools. `create_workflow_draft` and `reconcile_pending_connector` carry `destructiveHint: true` and `idempotentHint: false`.

```bash
pnpm --filter @tsh/mcp exec mcp-inspector --cli http://localhost:3100/mcp --transport http \
  --method tools/call --tool-name onboarding_stats --tool-arg groupBy=status
```

The `groups` of the result, with the score summaries left out:

| `group`                  | `count` |
| ------------------------ | ------- |
| `awaiting_user`          | 17      |
| `rejected`               | 12      |
| `approved`               | 11      |
| `awaiting_manual_review` | 4       |
| `invalid`                | 2       |

The result also carries `matched: 46` and `truncated: false`. The 17 `awaiting_user` onboardings are the 11 abandoned, 4 parked and 2 duplicate-applicant ones.

For one onboarding, `get_onboarding_timeline` returns its events in time order. For `score-reject-03` the deciding one is the transition at `collect_profile`, with the score moving from 0 to 90:

```json
{
  "kind": "transition",
  "action": "onboarding.state_transition",
  "move": {
    "fromStatus": "awaiting_user",
    "toStatus": "rejected",
    "fromStep": "collect_profile",
    "toStep": null,
    "fromScores": { "risk": 0 },
    "toScores": { "risk": 90 }
  }
}
```

The write tools are not part of these checks. Called without a `confirmationToken` they change nothing, but calling them with one acts on the engine; leave that to the assistant after you have read a preview.

## Next

Read [what the assistant can and cannot see](./ai-assistant.md), then try the question you would ask on real data.
