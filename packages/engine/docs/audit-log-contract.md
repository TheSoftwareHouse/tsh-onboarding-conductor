# Audit log contract

The audit log is historical operational evidence of meaningful engine activity. It helps developers, operators, and auditors understand what the engine observed and what it persisted at a point in time. It is not a live state store.

## Reliability

- A persisted onboarding state change has a corresponding audit fact when the transaction succeeds. The audit fact and the state change are atomic where the engine applies them together: either both persist or neither does.
- Callback-applied onboarding state facts and outbox state-transition facts follow the same atomicity rule where applicable.
- Receipt, rejection, mapping, endpoint-resolution, and resend observations are best effort. They may be absent if audit writing fails, and such a failure must not change the underlying engine or webhook behavior.
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

## Implemented contract

Audit records are historical evidence of engine activity. Every writer uses `actorType: system` and `actorId: engine`. The storage entity is `audit_log` with these fields:

`id`, `occurredAt`, `actorType`, `actorId`, `action`, `resourceType`, `resourceId`, `before`, `after`, `metadata`, `hashPrev`, and `hashSelf`.

The current writers set `hashPrev` and `hashSelf` to `null`. Lifecycle events use onboarding snapshots; webhook events use `before: null` and `after: null`. The rejected-attempt event also has no snapshots.

## Admin audit response

The admin endpoint is `GET /v1/admin/audit`. It supports these filters:

`actorType`, `actorId`, `action`, `resourceType`, `resourceId`, `occurredFrom`, and `occurredTo`.

Pagination uses `page` and `limit`. The response contains `items` and `meta.pagination` with `page`, `limit`, `total`, and `totalPages`. Each item includes the record identifiers, timestamp, actor and resource fields, action, and projected `metadata`.

The read projection filters lifecycle and rejected-attempt metadata to their documented fields. Webhook metadata is returned as stored. This does not make arbitrary caller metadata a general contract: each event family below defines its intended metadata.

## Event catalog

All actions currently implemented by the engine are listed below.

### Lifecycle events

These events use `resourceType: onboarding` and onboarding snapshots in `before` and `after`.

| Action                              | When emitted                                | Metadata                                                                                                                 | Snapshots                                              |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `onboarding.started`                | An onboarding starts.                       | `workflowId`, `workflowVersion`, `appliedStep`, `fromStatus: null`, `toStatus`, `fromCurrentStep: null`, `toCurrentStep` | `before: null`; `after`: new onboarding snapshot       |
| `onboarding.state_transition`       | A persisted onboarding state change occurs. | `workflowId`, `workflowVersion`, `appliedStep`, `fromStatus`, `toStatus`, `fromCurrentStep`, `toCurrentStep`             | Previous snapshot in `before`; new snapshot in `after` |
| `onboarding.manual_review_decision` | A manual review decision is persisted.      | The state-transition fields plus `manualTrigger`                                                                         | Previous snapshot in `before`; new snapshot in `after` |

An onboarding snapshot contains `id`, `workflowId`, `workflowVersion`, `status`, and `currentStep`.

### Rejected attempts

`onboarding.rejected_attempt` uses `resourceType: onboarding`, has `before: null` and `after: null`, and records only `operation` and an allowlisted `outcome`.

| Operation       | Allowed outcomes                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `submit`        | `onboarding_not_found`, `onboarding_completed`, `retryable_invalid_data`, `unknown_workflow_evaluation`                       |
| `manual_review` | `onboarding_not_found`, `onboarding_completed`, `unsupported_action`, `transition_unavailable`, `unknown_workflow_evaluation` |

### Inbound webhook events

Inbound events record safe receipt and processing context only. They use `resourceType: provider_callback`, except `webhook.inbound_callback_applied`, which uses `resourceType: onboarding`.

| Action                                    | Intended metadata                                                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook.inbound_callback_received`       | Safe receipt context, such as `ingress: provider_callback`                                                                                                                         |
| `webhook.inbound_callback_rejected`       | A stable `reason`, such as `raw_body_required`, `provider_key_invalid`, or `authentication_failed`                                                                                 |
| `webhook.inbound_callback_mapping_failed` | `reason: mapping_failed` and safe resolved provider context when applicable                                                                                                        |
| `webhook.inbound_callback_applied`        | Safe resolved provider identity, connector order/result when applicable, and `outcome: persisted`; this event is transactionally coupled to callback-driven onboarding persistence |

Inbound audit metadata must exclude raw inbound request bodies, inbound payloads, submitted or mapped data, headers and signatures, credentials, endpoint URLs or paths, response or error bodies, and exception text.

### Outbound webhook events

Outbound events retain the complete outbound payload when one was constructed or stored. They use the resource types shown below.

| Action                                        | Resource                | Intended metadata                                                                                                                                                  |
| --------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `webhook.outbound_notification_suppressed`    | `onboarding`            | Suppression `operation` and `reason`; `payload` is `null` when no payload exists                                                                                   |
| `webhook.outbound_endpoint_resolution_failed` | `onboarding`            | Stable event and `reason` context plus the complete payload when constructed; no endpoint URL/path or exception text                                               |
| `webhook.outbound_intent_created`             | `client_webhook_outbox` | Outbox and onboarding identifiers, event type, `status`, `attempt`, and complete payload                                                                           |
| `webhook.outbound_delivery_attempted`         | `client_webhook_outbox` | Outbox and onboarding identifiers, event type, and `attempt`, plus complete payload                                                                                |
| `webhook.outbound_delivery_succeeded`         | `client_webhook_outbox` | Outbox and onboarding identifiers, event type, `attempt`, `status`, and complete payload; emitted only after successful conditional finalization                   |
| `webhook.outbound_delivery_failed`            | `client_webhook_outbox` | Outbox and onboarding identifiers, event type, `attempt`, `status`, stable failure context, and complete payload; emitted only after successful restore to pending |
| `webhook.outbound_resend_requested`           | `client_webhook_outbox` | Resend operation context and complete stored payload when the row exists                                                                                           |
| `webhook.outbound_resend_not_found`           | `client_webhook_outbox` | `outcome: not_found` and `payload: null`                                                                                                                           |
| `webhook.outbound_resend_noop`                | `client_webhook_outbox` | `outcome: already_delivered`, `already_sending`, or `claim_lost`, with the complete stored payload when a row exists                                               |

## Transaction and robustness rules

- Lifecycle events and callback-applied or outbox state-transition facts use the owning `EntityManager` where applicable. Their audit record and state change commit or roll back together.
- Inbound receipt, rejection, and mapping observations, plus outbound suppression, endpoint-resolution, and resend observations, are best-effort. An audit write failure must not change the original webhook behavior.
- A successful or failed delivery-finalization event is not written when its conditional update affects zero rows.
- `client_webhook_outbox` remains authoritative for the current delivery endpoint and state. Audit is historical evidence and may duplicate the outbound payload.

## Sensitive-data contract

Full outbound payloads are intentionally retained in audit metadata. They are client-controlled or derived from client configuration and may contain sensitive or arbitrary business data. The application does not generally redact outbound metadata. This is intentional audit retention, not accidental logging.

The inbound safe-metadata exclusion boundary is separate: inbound audit must not retain the raw payload or transport and security material listed above. Outbound retention does not imply that those inbound values may be stored.

Consumers and administrators must:

- restrict access to the admin audit endpoint and systems that store or display its response
- avoid copying audit metadata or payloads into logs, traces, analytics, tickets, or other secondary stores
- apply deployment-level retention, access, export, and deletion controls appropriate to the client data
- avoid displaying full outbound payloads when a narrower audit view is sufficient
