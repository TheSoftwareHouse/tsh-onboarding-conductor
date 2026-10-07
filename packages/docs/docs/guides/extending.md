---
id: extending
title: Extending it
sidebar_label: Extending it
description: What you can add without touching engine code, and where the extension points are when code is really needed.
---

→ Most of what people want to add needs no engine code. A new flow is a JSON file, a new provider that speaks JSON over HTTP is configuration, and a new email is a template.

## Without code

- **A new onboarding flow.** Write a JSON file, drop it in `workflows/users/`, restart. The engine validates the file, stores it and serves it. The quickest start is to copy the closest example from the [fixtures gallery](/fixtures); each page carries the file itself.
- **A new provider.** If it speaks JSON over HTTP, describe the call in the workflow with the built-in `http_request` connector. Placeholders resolve from exactly three places: the connector's own field mapping, the `HTTP_CONNECTOR_SECRETS` map, and the current execution. There is deliberately no way to reach data the step did not declare, which is what keeps the outbound data flow auditable by reading the workflow alone. [Revision 2 of the built-in EEA flow](/fixtures/eu-b2c-individual-kyc-eea-v2) declares one through an `http-call` step, which derives the declaration from the request template.
- **A new email.** Add an HTML template under `email-templates/users/` and name it from the workflow.
- **A flow in fewer lines.** Every step in a workflow names a type. Write a step as `custom` to spell it out in full, or pick a specialized type such as `contact-details`, `otp-verify` or `manual-review` and let the engine derive the rest when the file loads. The built-in EEA flow ships both ways, [as custom steps](/fixtures/eu-b2c-individual-kyc-eea) and [as specialized steps](/fixtures/eu-b2c-individual-kyc-eea-v2).

## With code

When code really is needed, every extension point is a small, documented interface: a connector adapter for a provider with an SDK or a signature scheme of its own, an OTP channel for a new way of delivering a one-time code (the engine's `otp` connector generates and checks the code; a channel is one class that only delivers it), a connector error handler, a field type or text format, an email template, a step type, an SSO provider for the admin panel.

Those are described, one section each, in the repository's extending guide:
[docs/EXTENDING.md](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/blob/main/docs/EXTENDING.md).
The as-built specification, [docs/IMPLEMENTATION.md](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/blob/main/docs/IMPLEMENTATION.md), explains why each mechanism has the shape it has, and the [decision records](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/tree/main/docs/decisions) hold the choices behind it. Dedicated articles for each extension point will join this section.
