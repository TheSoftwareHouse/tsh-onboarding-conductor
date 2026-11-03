# Conductor analyst plugin

`conductor-analyst` gives an AI assistant in Claude Code or Codex access to the TSH Onboarding Conductor
for investigation and compliance work. It connects the assistant to the Conductor MCP server, which
reads the engine's admin API on the analyst's behalf.

| Skill                           | Use it to                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `investigating-onboarding`      | Explain why one onboarding is rejected, stuck, parked or in manual review      |
| `triaging-review-queue`         | Order the manual review queue and parked onboardings by reason and age         |
| `analysing-onboarding-funnel`   | Status mix, drop-off, time in step, rejection reasons, connector health        |
| `preparing-compliance-evidence` | Access, export and configuration-change evidence for an auditor                |
| `reviewing-risk-rules`          | Explain scoring rules, compare versions, propose a threshold change as a draft |

Claude Code also gets the `onboarding-investigator` agent (`agents/`), which investigates one or
several onboardings with read-only tools and returns a finding per onboarding.

The same `plugins/conductor-analyst/` tree serves both clients. Claude Code reads
`.claude-plugin/plugin.json`, Codex reads `.codex-plugin/plugin.json`, and both read the shared
`.mcp.json`.

## What the assistant can and cannot see

The MCP server masks every value before it reaches the model, and drops any value it cannot classify.

| Class          | Examples                                                                    | What the assistant gets                                                   |
| -------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `pass`         | status, step, scores, enumerated values, booleans, `country`, `nationality` | the value                                                                 |
| `pseudonymise` | email, phone                                                                | a token such as `email:` plus 12 hex characters, the same for equal input |
| `generalise`   | date of birth                                                               | a 10-year age band                                                        |
| `drop`         | names, addresses, free text, documents, anything unclassified               | nothing                                                                   |

The pseudonym is a keyed hash, so the assistant can tell that two onboardings share an email without
seeing it. Changing the server's masking key changes every pseudonym.

Masking limits what reaches the model. It is not access control: your own account can still read every
field in the admin panel, and the server does not narrow which onboardings, workflows or audit entries
your engine role allows you to query.

## What the assistant can change

Fourteen tools only read. Two change engine state, and each needs your confirmation:

- `reconcile_pending_connector` asks the engine for the verdict a provider already holds for a parked
  onboarding.
- `create_workflow_draft` stores a workflow document as a draft. It never publishes; publishing stays a
  human action in the admin panel.

Called the first time, either tool changes nothing: it returns a preview and a confirmation token that
is valid for five minutes, once, for those exact arguments and your user. The assistant must show you
the preview and call again only after you agree. An operator can remove both tools from the server with
`MCP_WRITE_TOOLS_ENABLED=false`.

Recording a manual-review decision, publishing or deleting a workflow version, changing connector
settings and anything touching encryption are not available through the server.

## Install in Claude Code

From a checkout of this repository, or from any repository once you have its URL:

```text
/plugin marketplace add ./
/plugin install conductor-analyst@tsh-onboarding-conductor
```

Use `/plugin marketplace add <owner>/<repository>` to add the marketplace from GitHub instead of a
checkout.

The server entry is named `conductor` and its address comes from the `CONDUCTOR_MCP_URL` environment
variable, defaulting to `http://localhost:3100/mcp`. Claude Code expands `${VAR:-default}` in
`.mcp.json`, so to reach a deployed server set the variable before starting Claude Code:

```bash
export CONDUCTOR_MCP_URL=https://conductor-mcp.example.com/mcp
```

## Install in Codex

```bash
codex plugin marketplace add <path-to-this-repository>
codex plugin add conductor-analyst@tsh-onboarding-conductor
```

`codex plugin marketplace add` also accepts `<owner>/<repository>` or a git URL.

Codex does not expand environment variables in a plugin's `.mcp.json`: the server entry it loads from
this plugin carries the literal text `${CONDUCTOR_MCP_URL:-http://localhost:3100/mcp}` as its address,
which is not a valid URL. A server of the same name in your own configuration takes precedence, so
register the address yourself, for the local stack or a deployed server alike:

```bash
codex mcp add conductor --url http://localhost:3100/mcp
```

`CONDUCTOR_MCP_URL` has no effect in Codex.

## Test locally

From the repository root, with `.env` copied from `.env.dist` and Docker running:

```bash
pnpm stack:mcp:up
pnpm onboardings:seed
```

`pnpm stack:mcp:up` starts the stack and the MCP server on `http://localhost:3100/mcp` with sign-in
switched off, so the plugin works with the defaults above. `pnpm onboardings:seed` fills the engine with
a fixed, synthetic population of onboardings, each ending in a different state (approved, rejected,
waiting for review, parked at a connector, abandoned, and more), and writes
`packages/onboarding-seeder/out/manifest.json`, which lists every scenario with the answer an
investigation should reach. No real personal data is involved. `pnpm onboardings:seed -- --spread-days 90`
spreads the onboardings over the last 90 days so date and funnel questions have shape; it rewrites
timestamps in the local database. `pnpm mcp:inspect` opens the MCP Inspector against the running server.

## Sign in against a deployed server

A deployed server has sign-in on (`MCP_AUTH_ENABLED=true`). You sign in with your Microsoft Entra
account, the server exchanges your token on your behalf, and the engine records each call under your
name. The server refuses to start with sign-in off when `NODE_ENV=production`.

The server relays sign-in to Entra itself, so you need no client id and no callback port. Ask your
administrator for the server address and that your user holds the engine's `admin` role.

In Claude Code, install the plugin, set the address before starting Claude Code, run `/mcp`, choose
`plugin:conductor-analyst:conductor` and sign in in the browser:

```bash
export CONDUCTOR_MCP_URL=https://conductor-mcp.example.com/mcp
```

In Codex, register the server and log in; Codex does not expand `${CONDUCTOR_MCP_URL}`, so it takes the
address itself:

```bash
codex mcp add conductor --url https://conductor-mcp.example.com/mcp
codex mcp login conductor
```

Not yet exercised from this repository: Claude Code's sign-in through the relay has not been run against
an Entra tenant, and the Codex sign-in has not been run at all. `codex mcp add --help` lists the sign-in
options your Codex version accepts.

For administrators: the server's Entra setup, including the public-client app registration that
`MCP_PUBLIC_CLIENT_ID` names and its _Mobile and desktop applications_ redirect URI
`http://localhost/callback` and `http://127.0.0.1/callback`, is described in `docs/IMPLEMENTATION.md` §14 and decision 0054.
