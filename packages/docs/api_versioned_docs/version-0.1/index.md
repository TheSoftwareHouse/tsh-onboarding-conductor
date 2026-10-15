---
id: index
title: API reference
sidebar_label: About this reference
slug: /
description: How the engine's HTTP API is organised, where the OpenAPI document comes from, and how to read the pages that follow.
---

→ Every route the engine exposes, with its request and response shapes and the exact error codes it can return. These pages are generated from the engine's own code, so what you read here is what the build you run serves.

## How it is organised

Routes are grouped by who calls them.

| Group              | Who calls it                              | Credential                                                                   |
| ------------------ | ----------------------------------------- | ---------------------------------------------------------------------------- |
| Onboarding flow    | Your front-end, on behalf of the customer | None. The onboarding id is the only handle, so treat it as a capability.     |
| Manual review      | An operator                               | None today, which is a known gap; see [Authentication](./authentication.md). |
| Admin              | The admin panel, or your own tooling      | A Microsoft Entra ID bearer token.                                           |
| Provider callbacks | A connector's provider                    | The HMAC signature the connector adapter declares.                           |
| Health             | Orchestration and load balancers          | None.                                                                        |

Every route lives under `/v1`. Locally that is `http://localhost:3000/v1`; in a deployment, wherever the engine is reachable. Request and response bodies are JSON, except the provider callback, which is read as the raw bytes the provider signed.

## Reading a route page

Each page shows the method and path, the parameters and body the route takes, one success response, and one entry per status the route can fail with. An error entry lists the `code` values that status can carry and what each one means. The panel on the right renders the same information as schemas and examples.

## The document itself

The reference is built from an OpenAPI 3.1 document generated from the engine's route and DTO decorators and committed beside the code; a test fails whenever the two disagree.

- [Download `engine.openapi.json`](pathname:///openapi/0.1/engine.openapi.json), the exact copy this site was built from.
- A running engine serves the same document at `GET /v1/openapi.json`.

Feed it to a client generator, or to any tool that reads OpenAPI.

## Older versions

Each earlier minor version of the engine keeps its own document, frozen when that version was
superseded. The version selector in the navigation bar switches these pages to it, and every version
offers its own download link on this page.
