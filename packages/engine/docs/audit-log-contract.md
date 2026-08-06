# Audit log contract

The audit log is historical operational evidence of meaningful engine activity. It helps developers, operators, and auditors understand what the engine observed and what it persisted at a point in time. It is not a live state store.

## Reliability

- A persisted onboarding state change has a corresponding audit fact when the transaction succeeds. The audit fact and the state change are atomic where the engine applies them together: either both persist or neither does.
- Callback-applied onboarding state facts and outbox state-transition facts follow the same atomicity rule where applicable.
- Receipt, rejection, mapping, suppression, endpoint-resolution, and resend observations are best effort. They may be absent if audit writing fails, and such a failure must not change the underlying engine or webhook behavior.
- The outbox remains the source of truth for current delivery state and endpoint data. Audit records describe history and may repeat outbound payload data; they do not guarantee the current outbox state.

## What a record means

Each record identifies the actor, time, resource, and action involved, together with safe contextual evidence. State-change records may include the relevant before-and-after onboarding state. Context should support investigation without turning the audit log into a copy of request or application data.

## Data boundaries

Inbound audit observations exclude raw request bodies, inbound payloads, headers and signatures, credentials, endpoint URLs or paths, response or error bodies, exception text, and ordinary inbound submitted or mapped data.

Callback-applied audit metadata is a deliberate sensitive-data retention exception: the implemented record may retain the submitted data and connector result that were applied while persisting the callback-driven onboarding change. This exception does not permit retaining inbound transport or security material, and it should be treated as sensitive.

Complete outbound payloads are intentionally retained when an outbound notification is constructed or stored. This is an explicit sensitive-data rule, not an accidental logging side effect; outbound payloads may contain client-controlled or business data and are not generally redacted.

## Operational expectations

Audit data is sensitive. Restrict access to the audit interface and to systems that store or display its responses. Avoid copying audit records or payloads into logs, traces, analytics, tickets, or other secondary stores. Apply deployment-governed retention, export, and deletion controls, and display narrower evidence instead of full payloads when possible.

## Non-guarantees

The audit log is not cryptographically tamper-evident. Best-effort observations are not guaranteed to exist. Audit history must not be used as the source of truth for current outbox state.
