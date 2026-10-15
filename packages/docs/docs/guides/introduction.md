---
id: introduction
title: Introduction
sidebar_label: Introduction
slug: /
description: What Onboarding Conductor is, what ships in the box, and the three calls every onboarding is made of.
---

→ Customer onboarding is the same handful of moving parts arranged differently for every product, market and regulator: identity checks, phone and email verification, document upload, a human review step. Conductor makes that arrangement a JSON file instead of a codebase.

You describe an onboarding as a list of steps: what each step asks the customer for, which third-party services it calls, and where each outcome leads. The engine runs it, keeps track of where every customer is, retries and resumes what needs it, and records what happened. Your front-end asks "what should I show now?" and posts back the answer.

## What ships

| Part        | What it is                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engine      | A NestJS service that runs workflows and exposes a small HTTP API. Everything below is about it.                                                                                                       |
| Admin panel | A React app where operators follow onboardings in progress, export them as CSV, read the audit trail and configure connectors. It ships inside the engine's image and is served from the same address. |
| Connectors  | Ready-made integrations for Twilio Verify, SendGrid, SMTP, Sumsub and Veriff, plus a generic one that calls any JSON API from configuration alone, so most providers need no new code.                 |

## How it works

An onboarding is one record: which workflow it follows, which step it is on, and the data collected so far. The client moves it forward with a single call. The engine validates the submitted data, calls that step's connectors, decides which transition applies and saves the result.

```text
POST /v1/onboardings              start one, from a workflow id
GET  /v1/onboardings/:id/state    what to show the customer right now
POST /v1/onboardings/:id/submit   send this step's answers; the engine advances
```

Manual review, waiting on a slow provider and finishing are the same shape with different content. The engine runs one kind of step, not a dozen. In the workflow file every step names a **type**, and there are two kinds to choose from. A `custom` step spells the step out in full, exactly as the engine runs it:

```json title="workflows/fixtures/base.workflow.json — the first step, written as a custom step"
{
  "name": "collect_email",
  "type": "custom",
  "config": {
    "status": "awaiting_user",
    "data": {
      "email": { "type": "text", "required": true, "validation": { "format": "email" } }
    },
    "connectors": [
      {
        "name": "mock_kyc_1",
        "id": "mock_kyc_1",
        "type": "kyc",
        "order": 1,
        "fieldMapping": { "email": "email" }
      }
    ],
    "transitions": [
      { "status": "success", "target": "accept_terms", "webhook": { "notify": false } }
    ]
  }
}
```

`status` is what the customer's onboarding looks like while it sits here. `data` is what the step asks the customer for. `connectors` names the providers this step calls and which of its fields they receive. `transitions` say where each outcome leads.

A **specialized** step says the same thing in fewer words. It names what the step is for and the engine derives the rest when the workflow loads: `contact-details` knows how an email field is validated, `connector-call` knows it has a `success` outcome, and `edges` wires that outcome to the next step.

```json title="The same step, written as a specialized step"
{
  "name": "collect_email",
  "type": "connector-call",
  "config": {
    "connectors": [
      {
        "name": "mock_kyc_1",
        "id": "mock_kyc_1",
        "type": "kyc",
        "order": 1,
        "fieldMapping": { "email": "email" }
      }
    ]
  },
  "include": [{ "type": "contact-details", "config": { "phoneNumber": "omitted" } }],
  "edges": { "success": [{ "target": "accept_terms", "webhook": { "notify": false } }] }
}
```

Both compile to the identical step, so the API, the admin panel and your front-end see no difference. The specialized types cover what an onboarding is made of: an address, a one-time code, a document capture, an identity check, a manual review. They are the form a drag-and-drop builder works in, and `custom` is the escape hatch for a step none of them describes. The two built-in revisions of the EEA onboarding are the same flow written both ways, 957 lines of `custom` steps or 271 lines of specialized ones.

## Two habits worth knowing up front

They explain most of what you will run into.

- **Everything is checked when the service starts.** Workflows, connector settings and configuration are validated at boot, so a mistake stops the start rather than surfacing as a failure on someone's onboarding.
- **A workflow already in flight never changes shape.** Publishing a new revision leaves existing customers on the one they started. Your front-end can rely on the step it was told about.

## Where to go next

- [Getting started](./getting-started.md) brings the stack up on your machine in five commands.
- [Your first onboarding](./your-first-onboarding.md) walks through the three calls above against a real workflow.
- The [API reference](/api) lists every route with its request, response and the exact error codes it can return.
