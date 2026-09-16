---
id: your-first-onboarding
title: Your first onboarding
sidebar_label: Your first onboarding
description: Start an onboarding, read the step to render, submit its data. Three requests against a workflow that ships with the repository.
---

→ The `base` example workflow ships with the repository, so there is something to run the moment the stack is up. After one operator call to publish the agreement it declares, three requests take a customer through its first step; the responses below come from a real local run. The example ships twice, as `base` written in `custom` steps and as `base-typed` written in specialized steps, and both compile to the same steps: every request and response below is the same under either id.

## Publish the agreement it declares

`base` declares one agreement family, `base-terms`, collected on its `accept_terms` step. An onboarding cannot start on a workflow whose declared family has no published version: the start answers `503 AGREEMENT_NOT_PUBLISHED`. So publish version 1 once, before the first start. The route is an operator one; a fresh clone runs with `ADMIN_AUTH_ENABLED=false`, so no token is needed locally.

```bash
$ curl -X POST localhost:3000/v1/admin/agreements \
    -H 'Content-Type: application/json' -d '{"key":"base-terms","type":"terms_and_conditions"}'
```

The response carries the version's id, its `version` (`1` on a fresh database) and `linkedOnboardings`, the count of existing onboardings it was linked to. Publish once: a second call cuts version 2 and marks every onboarding that accepted version 1 as outdated. The `Admin: agreements` group of the [API reference](/api) has the routes.

## Start one

An onboarding starts from a workflow id. The response carries the onboarding id every other call is keyed by, and where the customer now stands.

```bash
$ curl -X POST localhost:3000/v1/onboardings \
    -H 'Content-Type: application/json' -d '{"workflowId":"base"}'
{"onboardingId":"01a023ea-bf9e-772d-9f5a-f49b33b3dd1a","status":"awaiting_user",
 "currentStep":"collect_email","expiresAt":null}
```

:::warning Treat the id as a capability
The onboarding flow is unauthenticated: an end customer holds no operator identity, so the onboarding id is the only handle. Never log or share it beyond the client that owns the onboarding.
:::

## Read the step to render

The state route says what to show right now: the current step, its fields, which of them apply given the data so far, their persisted values for prefill, and the JSON Schema the next submit will be checked against.

```bash
$ curl localhost:3000/v1/onboardings/01a023ea-.../state
… "step": { "name": "collect_email", "canSubmit": true, "fields": [
     { "name": "email", "type": "text", "required": true, "value": null,
       "schema": { "type": "string", "format": "email" } } ] }
```

A front-end renders from this and nothing else. It does not need to know the workflow: `fields` lists what to ask for, `schema` says what the engine will accept, and `terminal: true` with `step: null` means there is nothing left to show.

## Submit the answers

You send exactly the fields the current step declares. The engine validates them, runs the step's connectors, applies the transition the outcome selects and reports where the onboarding now stands.

```bash
$ curl -X POST localhost:3000/v1/onboardings/01a023ea-.../submit \
    -H 'Content-Type: application/json' -d '{"email":"person@example.com"}'
{"appliedStep":"collect_email","status":"awaiting_user",
 "currentStep":"accept_terms","rejectionReason":null}
```

Anything missing, unknown or malformed comes back as `400` with a per-field explanation, and the onboarding stays where it was:

```bash
$ curl -X POST localhost:3000/v1/onboardings/01a023ea-.../submit \
    -H 'Content-Type: application/json' -d '{"acceptedTerms":"yes"}'
{"code":"INVALID_STEP_DATA","message":"INVALID_STEP_DATA","errors":{"acceptedTerms":["INVALID"]}}
```

## The loop your front-end runs

1. `GET /v1/onboardings/{id}/state` and render `step.fields`.
2. `POST /v1/onboardings/{id}/submit` with the answers.
3. Repeat until `terminal` is true. `status` then says how it ended: `approved`, `rejected` or `invalid`.

A step that waits on a slow provider or on an operator's decision looks the same from the outside: the state stays on it until the callback or the review arrives, and the next read shows the move.

## The same flow, written the other way

`base` spells each step out as a `custom` step. `base-typed` is the same three steps written with the specialized types `connector-call` and `terminal`; the [introduction](./introduction.md#how-it-works) shows its first step both ways and the [`base` page in the gallery](/fixtures/base) shows both files in full. Start from it and the engine answers the same, because the two files compile to identical steps:

```bash
$ curl -X POST localhost:3000/v1/onboardings \
    -H 'Content-Type: application/json' -d '{"workflowId":"base-typed"}'
{"onboardingId":"01a0902c-ba85-73bf-9891-afc10b66b7de","status":"awaiting_user",
 "currentStep":"collect_email","expiresAt":null}
```

```bash
$ curl localhost:3000/v1/onboardings/01a0902c-.../state
{"onboardingId":"01a0902c-ba85-73bf-9891-afc10b66b7de","workflowId":"base-typed","workflowVersion":1,
 "status":"awaiting_user","currentStep":"collect_email","terminal":false,"rejectionReason":null,
 "step": { "name": "collect_email", "canSubmit": true, "fields": [
     { "name": "email", "type": "text", "required": true, "value": null,
       "schema": { "type": "string", "format": "email" } } ] … } }
```

Only `workflowId` tells the two apart. The submit, its answer and the `400` for a wrong field are the ones shown above, byte for byte. Which form to write in is an authoring choice: the specialized types are shorter and are what a builder works in, and `custom` is there for a step none of them describes.

## Where to go next

- The [API reference](/api) covers the rest of the flow: document uploads, manual review, provider callbacks and the operator endpoints, each with the exact error codes it can return.
- The [fixtures gallery](/fixtures) has a workflow for each mechanism, ready to copy into `workflows/users/`.
