# 0051. The MCP acts on behalf of the signed-in analyst and exposes two confirmed write tools

- **Status:** Accepted
- **Date:** 2026-11-01
- **Tags:** mcp, security, auth, audit, azure
- **Supersedes:** —
- **Superseded by:** —

## Decision

The MCP has no service account. It is an OAuth protected resource whose RFC 9728 metadata points at
the Entra tenant. It verifies the analyst's access token (RS256, v2 issuer, audience =
`MCP_AZURE_CLIENT_ID`, expiry, and a delegated scope `Mcp.Access` in `scp`, the verification
approach of `packages/engine/src/auth/azure-token-verifier.ts`), then exchanges it on-behalf-of
through `@azure/msal-node` for a token scoped to the engine API and calls the engine with that. The
engine therefore sees the analyst's own roles and audits each call under the analyst's object id.
Exchanged tokens are cached per incoming-token hash and never shared between users.

Entra has no dynamic client registration, so agent clients sign in with a pre-registered public
client id pre-authorised on the MCP app registration; 0054 hands that id out through the MCP's own
sign-in relay, so the client is not configured with it.

`MCP_AUTH_ENABLED=false` is the local-development mode: no token checks, no token to the engine, the
caller recorded as `local`. The MCP refuses to start with it when `NODE_ENV=production` (the same
rule 0047 applies to `ADMIN_AUTH_ENABLED=false`).

**Two write tools, both behind a two-step confirmation; everything else is read-only.**
`reconcile_pending_connector` (0039) and `create_workflow_draft` (0034) are the only tools that
change engine state. Called without a `confirmationToken` they change nothing and return a preview
and a token: an HMAC, keyed from `MCP_MASKING_KEY` under a fixed `confirmation` label, over user
identity, tool name, canonicalised arguments and a five-minute expiry. It is single-use (used
tokens are held in memory until expiry); a token for other arguments or another user, an expired
one or a reused one is refused. Skills show the preview and call again only after the analyst agrees.
Both tools carry the MCP annotations `destructiveHint: true` and `idempotentHint: false`, and
`MCP_WRITE_TOOLS_ENABLED=false` removes them from the tool list.

**Deliberately not exposed:** recording a manual-review decision, publishing or deleting a workflow
version, changing connector settings, and anything touching encryption. A draft is never published
by the MCP; publishing stays a human action in the admin panel (0040).

## Context

The engine already audits admin calls by operator object id and roles when `ADMIN_AUTH_ENABLED` is on
(`auth/azure-jwt.guard.ts`). A shared service account would collapse every analyst into one actor, and the
MCP would hold standing engine access of its own. The manual-review route is unauthenticated and
attributes no actor (0021), so a review decision made through the MCP could not be traced to the
analyst at all. Reconcile (a request for a verdict the provider already holds) and an unpublished
draft are the two writes that are inert or reversible and audited under the analyst by the engine.

## Alternatives

| Option                                             | Why not                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| One service account for the MCP                    | The engine would audit every call as the same actor, and the MCP would hold engine access independent of any analyst |
| Forward the incoming token to the engine unchanged | The token's audience is the MCP app; the engine's verifier accepts only its own `AZURE_API_AUDIENCE`                 |
| Dynamic client registration                        | Entra does not offer it                                                                                              |
| Expose review decisions and publishing             | The review route is unauthenticated and unattributed (0021); publishing is a human decision (0040)                   |
| Read-only MCP                                      | Leaves a parked onboarding and a proposed threshold change as manual steps outside the investigation                 |
| Rely on client permission prompts alone for writes | A model could complete a write in one call; the token forces a preview and an explicit second call                   |

## Consequences

The MCP can do what the analyst can do, minus the tools it omits; an analyst with the engine's
admin role still has the admin panel. The Entra setup gains an MCP API app registration (exposing
`Mcp.Access`, holding the OBO secret, with delegated permission to the engine API app) and one
public client registration whose id the relay hands out (0054), so the plugin ships no client id.

Used confirmation tokens are held in process memory, so a restart forgets them and a second MCP
instance would not share them; a token's five-minute expiry bounds the window.

Adding review decisions later needs the engine to authenticate and attribute the review route
first. Reversing the OBO choice means introducing a service credential and a separate attribution
mechanism in the MCP's own log.
