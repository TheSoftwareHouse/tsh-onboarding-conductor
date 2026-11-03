# 0050. The MCP server is a separate layer that reaches the engine only over its admin API

- **Status:** Accepted
- **Date:** 2026-11-01
- **Tags:** mcp, architecture, api, audit, analytics
- **Supersedes:** —
- **Superseded by:** —

## Decision

`@tsh/mcp` is a separate NestJS package that calls the engine's admin HTTP API exactly as the admin
panel does, and nothing else. It holds no database connection, imports nothing from
`packages/engine/src/`, and the engine gains no route, DTO, migration or OpenAPI change for it. Its
client is typed from the generated `packages/shared/openapi/engine.openapi.json`.

Whatever the API lacks, the MCP computes itself: a timeline merged from `/transitions` and the audit
API, a `createdAt` range applied over the engine's paged list, and every aggregate (status mix,
funnel, connector health) built from paged audit reads or from the streamed CSV export (0044). The
engine's own audit trail (`audit_log`) records every call, so no second store of what analysts
looked at is needed beyond the MCP's one structured log line per tool call.

This record covers where the MCP sits and how it reaches data. Who it acts as is 0051, what it
returns is 0052.

## Context

Compliance and risk analysts need to investigate onboardings and analyse the population from an AI
client. The engine already exposes every read they need through the admin API and audits each admin
call under the caller's identity (`audit/audit.types.ts`). Building the toolkit must not destabilise
the engine: the work is scoped to leave `packages/engine/src/` untouched, so gaps in the API are
recorded as engine improvements instead of being closed in this change.

## Alternatives

| Option                                     | Why not                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| MCP module inside the engine               | Changes the engine and its image for an analyst-facing surface, and puts masking and AI-client concerns next to orchestration     |
| MCP reads PostgreSQL directly              | Bypasses the engine's authorization and audit trail, and couples the MCP to the schema and its migrations                         |
| Add the missing routes to the engine first | Date filter, bulk audit export and a CSV without personal-data columns are engine work, outside this change; listed as follow-ups |

## Consequences

**Every aggregate streams the full CSV export.** The export has no date filter, so
`onboarding_stats` reads every onboarding matching the engine's list filters and aggregates in the
MCP. Masked rows are cached per user and filter set in memory for a short TTL to bound the cost, and
the MCP allows one concurrent export per user. The cost disappears only when the engine gains a
`createdAt` range on list and export.

**The engine's audit log fills with `onboardings.exported` rows.** Each aggregate is one export
audited under the analyst (0044), so an analytics session looks like repeated data exports in the
access report, and a reader of that report cannot tell an aggregate from a download without the
MCP's own log.

**Engine gaps are inherited, not hidden.** The engine's audit does not record which client made a
call, and `POST /v1/onboardings/:id/review/:action` is unauthenticated (0021); neither is changed
here.

Reversing this means moving the tools into an engine module; the tool contracts and masking carry
over, the HTTP client does not.
