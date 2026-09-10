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

| Part        | What it is                                                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine      | A NestJS service that runs workflows and exposes a small HTTP API. Everything below is about it.                                                                                   |
| Admin panel | A React app where operators follow onboardings in progress, read the audit trail and configure connectors. It ships inside the engine's image and is served from the same address. |
| Connectors  | Ready-made integrations for Twilio Verify, SendGrid, SMTP and Sumsub, plus a generic one that calls any JSON API from configuration alone, so most providers need no new code.     |

## How it works

An onboarding is one record: which workflow it follows, which step it is on, and the data collected so far. The client moves it forward with a single call. The engine validates the submitted data, calls that step's connectors, decides which transition applies and saves the result.

```text
POST /v1/onboardings              start one, from a workflow id
GET  /v1/onboardings/:id/state    what to show the customer right now
POST /v1/onboardings/:id/submit   send this step's answers; the engine advances
```

Manual review, waiting on a slow provider and finishing are the same shape with different content. The engine has one kind of step, not a dozen. A step reads like this:

```json title="One step of a workflow"
{
  "name": "collect_email",
  "status": "awaiting_user",
  "data": {
    "email": { "type": "text", "required": true, "validation": { "format": "email" } }
  },
  "connectors": [
    {
      "name": "kyc",
      "id": "mock_kyc_1",
      "type": "kyc",
      "order": 1,
      "fieldMapping": { "email": "email" }
    }
  ],
  "transitions": [{ "status": "success", "target": "accept_terms" }]
}
```

`status` is what the customer's onboarding looks like while it sits here. `connectors` names the providers this step calls and which of its fields they receive. `transitions` say where each outcome leads.

Writing every step out by hand gets repetitive for a real flow, so a workflow can also be written as a graph of **typed nodes**: an address, a one-time-code check, an identity verification, wired together by their outcomes. That graph is turned into ordinary steps when the workflow loads, so nothing above changes. It is a shorter way to say the same thing, and the form a drag-and-drop builder works in. The two built-in revisions of the EEA onboarding are the same flow written both ways: 906 lines of steps, or 271 lines of nodes. Both are in the [fixtures gallery](/fixtures).

## Two habits worth knowing up front

They explain most of what you will run into.

- **Everything is checked when the service starts.** Workflows, connector settings and configuration are validated at boot, so a mistake stops the start rather than surfacing as a failure on someone's onboarding.
- **A workflow already in flight never changes shape.** Publishing a new revision leaves existing customers on the one they started. Your front-end can rely on the step it was told about.

## Where to go next

- [Getting started](./getting-started.md) brings the stack up on your machine in five commands.
- [Your first onboarding](./your-first-onboarding.md) walks through the three calls above against a real workflow.
- The [API reference](/api) lists every route with its request, response and the exact error codes it can return.
