# 0019. Optional application-level encryption of the onboarding context

- **Status:** Proposed
- **Date:** 2026-09-16
- **Tags:** encryption, security, onboardings, configuration
- **Supersedes:** —
- **Superseded by:** —

## Decision

The engine gains an opt-in application-level encryption layer over one column:
`onboardings.context` — the data a user submits while completing an onboarding. A deployment
turns it on with two environment variables — `ENCRYPTION_ENABLED=true` and a base64-encoded
32-byte `ENCRYPTION_KEY` — validated at bootstrap, never through the admin panel and never per
workflow. There is one key, AES-256-GCM, and no rotation in this version.

**Out of scope, deliberately:**

- **Connector credentials** (`connectors.settings`). These are operator-supplied deployment
  configuration — an API key, an account SID, an SMTP password — not data a user inputs during
  onboarding, so they fall outside what this decision covers.
- **The `audit_log` payload columns** (`before`, `after`, `metadata`). These record what the
  system did, not what a user typed into a form.
- **Uploaded documents.** The browser uploads straight to S3 via a presigned POST, so the engine
  never holds the plaintext bytes at upload time — file confidentiality stays the object store's
  responsibility.
- **`connector_applicant_references.applicantId`.** Looked up by equality behind a unique index,
  which needs deterministic encryption this version does not build.
- **`onboardings.scores`.** Reporting data derived from the context, not the user's input itself.

## Context

`onboardings.context` accumulates every answer a user gives while working through an onboarding
flow — potentially including personal and sensitive information, shaped entirely by whatever a
workflow's steps ask for. Some deployments need a second confidentiality layer above the
database for this specific data: a shared database instance, a backup leaving the organization's
control, or a compliance requirement asking for encryption at the application layer specifically.

The column's storage shape is what made an opt-in cheap: `onboardings.context` is `jsonb`, and no
query builder, raw SQL, index or admin filter inspects its contents — it is read and written
wholesale. A TypeORM column `ValueTransformer` therefore converts between plain JSON and an
encrypted envelope at the ORM boundary with no visible change to any repository or service, and
the envelope is itself a JSON object, so it satisfies the column's existing `jsonb` CHECK
constraint. No migration was needed.

## Alternatives

| Option                                                        | Why not                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Make encryption mandatory rather than opt-in                  | Every deployment would pay for a key it may not need; a deployment whose database already meets its confidentiality bar gains nothing from a forced switch                                                                      |
| An admin-panel toggle, switchable per deployment at runtime   | A column already holding plaintext rows cannot become "encrypted" retroactively without a backfill this version does not build, and a mid-flight toggle risks a write racing a read under the old setting                       |
| Per-workflow encryption (some workflows encrypted, some not)  | `onboardings.context` is one shared column across every workflow; a per-workflow flag would need per-row key material tracking this version does not build                                                                      |
| Also cover connector credentials and audit payloads           | Neither is data a user inputs during onboarding — credentials are operator-supplied configuration and audit payloads describe system actions; scoping to `context` keeps the change to the data this decision is actually about |
| Deterministic encryption or a blind index for `context`       | `context` has no equality lookup that needs it, and deterministic encryption would weaken semantic security for no benefit here                                                                                                 |
| A KMS- or Vault-backed key instead of an environment variable | Removes the "one key, no rotation" simplicity this version is scoped to; a real candidate for a rotation follow-up, not for v1                                                                                                  |

## Consequences

**The threat boundary is database-level exposure, not process-level.** This protects a logical
dump, a backup, a replica, or an operator with a bare `psql` session. It does **not** protect
against an attacker who has the running engine process or its environment — they hold the key the
same way the engine does. Encryption at this layer complements the deployment database's own
protections; it does not replace the need to secure the database itself.

**Ciphertext is bound to its column, not to its row.** The additional authenticated data is the
column label, `onboardings.context`, so a value moved into a different column fails to decrypt. A
value moved between _rows of the same column_ does not: an attacker with write access to the
database could swap two onboardings' contexts, and the engine would decrypt the swapped value
without complaint. That is outside the read-exposure boundary above and is deliberately not
defended against here; binding the envelope to a row identity as well is a candidate for the same
future change that adds key rotation.

**Losing `ENCRYPTION_KEY` makes every encrypted row unrecoverable.** There is no escrow and no
recovery path. This is a deliberate consequence of shipping one key with no rotation, not an
oversight, and both the operator documentation and the engine's own bootstrap validation state it.

**Turning `ENCRYPTION_ENABLED` off after it was on leaves unreadable envelopes.** A row written
while encryption was enabled stays an opaque `{"__tsh_enc": ..., "d": ...}` envelope forever unless
the flag is turned back on with the original key — reading it with encryption disabled throws a
named error rather than returning ciphertext as if it were data. There is no backfill or
re-encryption command in this version to undo either direction of that switch.

**Mixed plaintext and ciphertext rows coexist safely.** Because the envelope is stored inside the
existing `jsonb` column rather than a new one, turning encryption on does not require touching rows
written before the switch: they are read back unchanged, and only rows written from that point on
become envelopes. This is what let the change ship with no migration.

**Reversing this decision is cheap in one direction and not in the other.** Turning
`ENCRYPTION_ENABLED` back off is a configuration change with no code to revert — but any row
written while it was on is unreadable once it is off, per the consequence above. There is no cost
to a deployment that never turns it on: the code path it would exercise does not run.

**Key rotation and covering more columns remain open.** The envelope's `__tsh_enc` marker already
carries a version string, so a future rotation scheme is additive rather than breaking, but
neither key rotation nor a KMS-backed key is built here. Extending coverage to another column —
connector credentials, audit payloads, or anything else — is a separate decision with its own
scope boundary, not an assumed next step of this one.
