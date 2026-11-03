---
id: connecting
title: Connecting Claude Code or Codex
sidebar_label: Connecting a client
description: Install the conductor-analyst plugin in Claude Code or Codex, point it at a deployed MCP server and sign in with Entra through the server's own sign-in relay.
---

→ Add this repository as a plugin marketplace, install `conductor-analyst`, and point the client at the server's address. For a deployed server an administrator must set up the Entra registrations first; you then sign in with your Entra account, with no client id and no callback port.

## What an administrator sets up first

Sign-in against a deployed server needs, in your Microsoft Entra tenant:

1. An app registration for the MCP server. It exposes the delegated scope `Mcp.Access`, holds a client secret for the on-behalf-of exchange, and has delegated permission to the engine's API app.
2. A public-client app registration, in the same tenant, with a _Mobile and desktop applications_ redirect URIs `http://localhost/callback` and `http://127.0.0.1/callback`, pre-authorised on the MCP server's app. The server hands its client id (`MCP_PUBLIC_CLIENT_ID`) to every client through its own sign-in relay, because Entra has no dynamic client registration. Leave it unset to use the MCP server's own registration; a separate registration is recommended in production. Entra is expected to ignore the port of a loopback redirect URI; a first sign-in has yet to confirm it.
3. Your user, holding the engine's `admin` app role. The engine sees your own roles, so the assistant can read only what you can.

On the server, `MCP_AUTH_ENABLED=true` with `MCP_AZURE_TENANT_ID`, `MCP_AZURE_CLIENT_ID`, `MCP_AZURE_CLIENT_SECRET`, `MCP_ENGINE_SCOPE` and `MCP_PUBLIC_URL` set, and `MCP_PUBLIC_CLIENT_ID` for the registration above. `MCP_PUBLIC_URL` must be HTTPS outside localhost, because the server is the sign-in issuer its clients talk to. The server refuses to start with sign-in off when `NODE_ENV=production`. Every variable is documented in `.env.dist`. Ask your administrator for the server address.

For the local stack none of this applies: sign-in is off. See [Trying it locally](./trying-it-locally.md).

## Claude Code

From a checkout of the repository, or by `<owner>/<repository>` for a GitHub copy:

```text
/plugin marketplace add ./
/plugin install conductor-analyst@tsh-onboarding-conductor
```

The plugin registers a server named `conductor` at `${CONDUCTOR_MCP_URL:-http://localhost:3100/mcp}`. Claude Code expands that variable, so to reach a deployed server set it before starting Claude Code:

```bash
export CONDUCTOR_MCP_URL=https://conductor-mcp.example.com/mcp
```

## Codex

```bash
codex plugin marketplace add <path-to-this-repository>
codex plugin add conductor-analyst@tsh-onboarding-conductor
```

`codex plugin marketplace add` also accepts `<owner>/<repository>` or a git URL. Codex does not expand environment variables in a plugin's `.mcp.json`, so the entry the plugin ships carries the literal text `${CONDUCTOR_MCP_URL:-…}` and is not a valid address. Register the server yourself, for the local stack or a deployed one; a server of the same name in your own configuration takes precedence:

```bash
codex mcp add conductor --url http://localhost:3100/mcp
```

`CONDUCTOR_MCP_URL` has no effect in Codex.

## Sign in

:::caution Not yet exercised
Nobody has yet completed a Claude Code sign-in through the server's relay against an Entra tenant from this repository, and no Codex sign-in has been run at all.
:::

The server relays sign-in to Entra, so you register no client id and no callback port.

In Claude Code, with `CONDUCTOR_MCP_URL` set as above, run `/mcp`, choose `plugin:conductor-analyst:conductor` and sign in in the browser.

In Codex, register the server and log in. Codex does not expand `${CONDUCTOR_MCP_URL}`, so give it the address:

```bash
codex mcp add conductor --url https://conductor-mcp.example.com/mcp
codex mcp login conductor
```

`codex mcp add --help` lists the other sign-in options your Codex version accepts.

A client that is not signed in gets `401` with a `WWW-Authenticate` header naming the server's protected-resource metadata; that is how the client finds the sign-in flow. Once signed in, each call reaches the engine under your own identity and is audited there by name.

## Check the connection

Run `/mcp` in Claude Code, or `codex mcp list` in Codex, and confirm `conductor` is connected. Then ask a question the assistant can only answer from the server, such as which workflows the engine knows. To see the server's tools without an assistant, use the Inspector as in [Trying it locally](./trying-it-locally.md).

## Next

Learn what the assistant sees: [AI assistant for compliance teams](./ai-assistant.md).
