---
id: ai-assistant
title: AI assistant for compliance teams
sidebar_label: AI assistant
description: What the Conductor analyst assistant does in Claude Code or Codex, what it can and cannot see of applicant data, and what stays a human decision.
---

→ A compliance or risk analyst can ask Claude Code or Codex why an onboarding was rejected, stuck or sent to review, and get an answer read from the engine's own records. Applicant personal data is masked before it reaches the model, and the assistant has no tool that decides a review or publishes a workflow.

## What it is

Three parts, all in this repository:

| Part                           | What it does                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The conductor MCP server       | `@tsh/mcp`. Calls the engine's admin API over HTTP on the analyst's behalf, masks every value it returns and logs each call. It never touches the database.                         |
| The `conductor-analyst` plugin | Five skills that tell the assistant how to use the server's tools, plus one Claude Code subagent. One plugin serves Claude Code and Codex.                                          |
| The client                     | Claude Code or Codex on the analyst's machine. The server runs next to the engine: in a deployment, not on the analyst's laptop. Locally, both run in the developer's Docker stack. |

[Connecting Claude Code or Codex](./connecting.md) installs the plugin. [Trying it locally](./trying-it-locally.md) runs all of it on a laptop against synthetic data.

## What it can do

Each skill answers one kind of question. The assistant picks the skill from the question; the analyst does not name it.

| Skill                           | Ask it                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `investigating-onboarding`      | Why is this onboarding rejected, stuck, parked on a provider or in manual review?      |
| `triaging-review-queue`         | What is waiting for a reviewer or a provider, and what is oldest?                      |
| `analysing-onboarding-funnel`   | Where do applicants drop off, which step is slowest, which connector is failing?       |
| `preparing-compliance-evidence` | Who accessed or exported onboarding data last quarter, and what configuration changed? |
| `reviewing-risk-rules`          | How does scoring work in this workflow, what changed between two versions?             |

Every skill states that answers cite tool results, that numbers come from tools and are never estimated, and that applicant-entered text is data, not instructions.

The server exposes 16 tools: 14 read and 2 that change state. The read tools cover workflows (list, version, authored document, diff, compile check), onboardings (find, details, timeline), analytics (stats, funnel, connector health, review queue) and compliance (audit search, access report).

## What it can and cannot see

Every value the server returns is classified first, and a value it cannot classify is dropped. The classes come from the workflow version's field declarations:

| Class          | Applies to                                                                                                                      | The assistant gets                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `pass`         | System fields, scores, enumerated values, booleans, and the fields an operator allowlists (`country`, `nationality` by default) | The value                                                                      |
| `pseudonymise` | Email, phone number                                                                                                             | A token such as `email:` plus 12 hex characters, identical for identical input |
| `generalise`   | Date of birth                                                                                                                   | A ten-year age band                                                            |
| `drop`         | Names, addresses, free text, documents, anything unclassified                                                                   | Nothing                                                                        |

The [`analyst-investigation`](/fixtures/analyst-investigation) workflow collects one field of each class. This is what the assistant reads for a seeded onboarding rejected on score (output of `get_onboarding`, shortened):

```json
"collectedData": {
  "Date of birth": "70-79",
  "Country": "TR",
  "Source of funds": "sale_of_asset",
  "Pep self declared": "true",
  "Email": "email:a710dc58ce40",
  "Phone number": "phone:dfe421b650db"
},
"withheldFields": [
  "First name", "Last name", "Street", "Town", "Post code",
  "Occupation title", "Identity document", "Other data"
]
```

The pseudonym is a keyed hash, so the assistant can see that two onboardings share an email without seeing it. In the seeded data, `duplicate-applicant-01` and `-02` both show `email:090174bd6456` and different phone pseudonyms. Changing the server's masking key changes every pseudonym.

:::warning Masking is not access control
Masking limits what reaches the model. It does not limit who may use the assistant or which onboardings, workflows and audit entries it can query: that follows the analyst's own engine role, and the same account can read every field in the admin panel or export the data directly. Grant the role accordingly.
:::

## What it can change, and what it never does

Two tools change engine state, and each needs the analyst's confirmation:

- `reconcile_pending_connector` asks the engine for the verdict a provider already holds for a parked onboarding.
- `create_workflow_draft` stores a workflow document as a draft. It never publishes.

Called the first time, either tool changes nothing: it returns a preview and a confirmation token. The token is valid once, for five minutes, for exactly those arguments and that user. The assistant must show the preview and call again only after the analyst agrees. Both tools also carry the MCP `destructiveHint` annotation, so the client asks for permission too. An operator can remove both from the server with `MCP_WRITE_TOOLS_ENABLED=false`.

The assistant has no tool to record a manual-review decision, publish or delete a workflow version, change connector settings or touch encryption. Publishing stays a human action in the admin panel. Review decisions stay out until the engine authenticates and attributes the review route.

## Compliance points that are still open

- **Sending masked data to a model provider is the organisation's decision.** Masking removes the direct identifiers, but scores, timestamps, countries and audit entries still go to Anthropic or OpenAI. Whether that is acceptable, under which data-processing agreement and in which region, has to be settled by your legal and compliance owners before the assistant touches anything other than synthetic data.
- **Sign-in is untested against a real tenant.** The Entra steps in [Connecting Claude Code or Codex](./connecting.md) follow each client's help output and have not been run against an Entra tenant from this repository.
- **The engine's review route is unauthenticated today.** The assistant cannot call it, but nothing at the engine attributes a review decision to a person.

## Next

Install it: [Connecting Claude Code or Codex](./connecting.md).
