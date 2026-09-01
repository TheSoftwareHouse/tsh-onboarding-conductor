# Audit log contract

The audit log is historical operational evidence of meaningful engine activity. It helps developers, operators, and auditors understand what the engine observed and what it persisted at a point in time. It is not a live state store.

## Reliability

- A persisted onboarding state change has a corresponding audit fact when the transaction succeeds. The audit fact and the state change are atomic where the engine applies them together: either both persist or neither does.
- Callback-applied onboarding state facts and outbox state-transition facts follow the same atomicity rule where applicable.
- Receipt, rejection, mapping, endpoint-resolution, and resend observations are best effort. They may be absent if audit writing fails, and such a failure must not change the underlying engine or webhook behavior.
- Connector failure-decision observations — a retry, a fallback taking over, a swallowed failure, or a propagated one — are best effort in the same sense: a failed write is logged and swallowed rather than turning a working fallback into a failed submit. They are written in their own transaction rather than the caller's, because the connector chain that produced the decision runs inside the onboarding's submit transaction, and a row written on that transaction's manager would be rolled back with a failed submit — losing precisely the rows an operator would go looking for.
- The outbox remains the source of truth for current delivery state and endpoint data. Audit records describe history and may repeat outbound payload data; they do not guarantee the current outbox state.

## What a record means

Each record identifies the actor, time, resource, and action involved, together with safe contextual evidence. State-change records may include the relevant before-and-after onboarding state. Context should support investigation without turning the audit log into a copy of request or application data.

The `connector.*` family records one decision a connector's error handler returned when its adapter threw: `connector.failure_retried` when the same connector is called again, `connector.failure_fell_back` when its declared fallback takes over, `connector.failure_ignored` when the failure is swallowed and the chain proceeds, and `connector.failure_propagated` when the failure is rethrown — either because the handler said so, or because the engine could not honour a `retry` past its attempt cap or a `fallback` with nothing declared. Their metadata names the connector that failed, the connector that took over, the handler that decided, the attempt number, and the failure's HTTP status and error class name. It never carries the error's message, the connector payload, a credential or an endpoint URL, which keeps this family inside the data boundary below rather than relying on an exception string being harmless. These rows are filed against the onboarding resource without joining the lifecycle trail: they describe something that happened to the onboarding on the engine's own initiative, not a state it entered, so a reader reconstructing the journey through the lifecycle actions alone does not see them.

## Data boundaries

Inbound audit observations exclude raw request bodies, inbound payloads, headers and signatures, credentials, endpoint URLs or paths, response or error bodies, exception text, and ordinary inbound submitted or mapped data.

Callback-applied audit metadata is a deliberate sensitive-data retention exception: the implemented record may retain the submitted data and connector result that were applied while persisting the callback-driven onboarding change. This exception does not permit retaining inbound transport or security material, and it should be treated as sensitive.

Complete outbound payloads are intentionally retained when an outbound notification is constructed or stored. This is an explicit sensitive-data rule, not an accidental logging side effect; outbound payloads may contain client-controlled or business data and are not generally redacted.

## Operational expectations

Audit data is sensitive. Restrict access to the audit interface and to systems that store or display its responses. Avoid copying audit records or payloads into logs, traces, analytics, tickets, or other secondary stores. Apply deployment-governed retention, export, and deletion controls, and display narrower evidence instead of full payloads when possible.

## Non-guarantees

The audit log is not cryptographically tamper-evident. Best-effort observations are not guaranteed to exist. Audit history must not be used as the source of truth for current outbox state.
