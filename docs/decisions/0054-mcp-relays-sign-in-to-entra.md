# 0054. The MCP relays its clients' sign-in to Entra

- **Status:** Accepted
- **Date:** 2026-11-02
- **Tags:** mcp, security, auth, azure, oauth
- **Supersedes:** —
- **Superseded by:** —

## Decision

With `MCP_AUTH_ENABLED=true` the MCP server is the authorization server its own metadata names, and
it relays to Entra. The protected-resource metadata (RFC 9728) lists `MCP_PUBLIC_URL` as the only
authorization server, and the server answers four routes there:

- `GET /.well-known/oauth-authorization-server` and `GET /.well-known/openid-configuration`: RFC 8414
  metadata with the three endpoints below, `S256` as the only code challenge method and `none` as the
  only client authentication, so a client treats the server as a public-client authorization server.
- `GET /oauth/authorize` answers `302` to the tenant's `oauth2/v2.0/authorize` carrying only the
  parameters Entra needs; `resource` is dropped, and `offline_access` is added to `scope` so Entra issues
  a refresh token. A `client_id` other than `MCP_PUBLIC_CLIENT_ID`, a `response_type` other than `code`
  or a `code_challenge_method` other than `S256` is refused with `400` and no redirect.
- `POST /oauth/token` forwards the grant fields (`authorization_code` or `refresh_token`) to the
  tenant's `oauth2/v2.0/token`, again without `resource`, and returns Entra's status and body
  unchanged. It never logs a body, a code, a verifier or a token.
- `POST /oauth/register` is a stateless registration shim (RFC 7591): for loopback redirect URIs
  (`http://localhost` or `http://127.0.0.1`) it answers with `MCP_PUBLIC_CLIENT_ID` and stores nothing.

Entra still authenticates the user and checks the redirect URI, PKCE and consent. The access token a
client ends up with is Entra's, `TokenVerifier` verifies it exactly as before and the on-behalf-of
exchange is unchanged (0051). `MCP_PUBLIC_CLIENT_ID` defaults to `MCP_AZURE_CLIENT_ID`; the routes
answer `404` while auth is off.

## Context

0051 had each agent client sign in with a pre-registered public client id and left open whether that
would work. Against a real tenant on 2026-11-01 and 2026-11-02 it did not, in two ways:

- Claude Code's own sign-in failed with `AADSTS9010010`. The MCP client sends the RFC 8707 `resource`
  parameter (the MCP URL) next to the scope `api://<client>/Mcp.Access`, and Entra v2 rejects that pair.
- A client with no client id of its own failed with "Incompatible auth server: does not support dynamic
  client registration", because Entra offers no registration endpoint.

Both come from talking to Entra directly, so one component that sits between the client and Entra fixes
both: the analyst installs the plugin, runs `/mcp` and signs in, with no client id and no callback port.

## Alternatives

| Option                                                               | Why not                                                                                                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A pre-registered client id per client, passed by each analyst (0051) | Registration is solved, `resource` is not: Claude Code's sign-in still failed with `AADSTS9010010`; and every analyst needs an id and a callback port |
| An authorization server in the MCP that issues its own tokens        | The MCP would store codes and tokens and become a second token issuer, and the on-behalf-of chain to the engine would have to be redesigned           |
| A gateway in front of the MCP doing the same rewriting               | Another deployed component to run, secure and keep in step with the MCP, for four small routes                                                        |

## Consequences

`MCP_PUBLIC_URL` must be HTTPS outside localhost: it is the issuer, and clients send the user's
authorization code and refresh token through the relay's token route. The server stores no tokens and
no registrations; Entra stays the only token issuer, and a restart forgets nothing.

The relay adds an outbound path from the MCP to Entra's token endpoint, and a network policy that
blocks it breaks every sign-in and refresh; an unreachable Entra answers `502`.

Every client is handed `MCP_PUBLIC_CLIENT_ID`. A production deployment should set it to a separate
public-client app registration, with a _Mobile and desktop applications_ redirect URI
`http://localhost/callback` and `http://127.0.0.1/callback`, rather than reuse the MCP API app, which holds the on-behalf-of secret.
Entra is expected to ignore the port of a loopback redirect URI, which is why no callback port is
configured; a first sign-in has yet to confirm it.

Claude Code sign-in through the relay has not yet been exercised by an analyst, and Codex sign-in
(`codex mcp login conductor`) has not been exercised at all.

This replaces the client-registration paragraph of 0051 (a pre-registered client id per agent) and the
registration-shim question 0053 left open; the rest of both stands.
