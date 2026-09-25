# 0024. Application-level encryption of the onboarding context, switched from the admin panel

- **Status:** Accepted
- **Date:** 2026-09-21
- **Tags:** encryption, security, onboardings, admin-panel
- **Supersedes:** —
- **Superseded by:** —

## Decision

The engine gains an application-level encryption layer over one column: `onboardings.context` —
the data a user submits while completing an onboarding. An operator turns it on and off from the
admin panel's Encryption page (`PATCH /v1/admin/encryption`), never through configuration and
never per workflow. Turning it on encrypts every stored onboarding in the background and every new
write on the way in; turning it off decrypts every stored onboarding back to plain JSON. Either
way the whole table converges to the chosen state, and every row stays readable throughout. The
cipher is AES-256-GCM; the envelope is stored inside the existing `jsonb` column.

The one piece of configuration is the key-encryption key, `ENCRYPTION_KEY` (record 0025): optional
until encryption is first turned on, and required at boot from then on.

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

The column's storage shape is what made the layer cheap: `onboardings.context` is `jsonb`, and no
query builder, raw SQL, index or admin filter inspects its contents — it is read and written
wholesale. A TypeORM column `ValueTransformer` therefore converts between plain JSON and an
encrypted envelope at the ORM boundary with no visible change to any repository or service, and
the envelope is itself a JSON object, so it satisfies the column's existing `jsonb` CHECK
constraint.

Whether that layer is on is an operator's decision about the data, not a property of the
deployment: the people who decide it are the ones running the admin panel, and they may need to
change it without a redeploy. A first version made it an environment switch because it could not
yet move existing rows — a table holding plaintext could not become encrypted, and turning the
switch off stranded every envelope already written. The background sweep record 0025 builds
removed that constraint: with rows movable in both directions, the switch belongs where the
operator is, and the table always ends up in the state the panel reports.

## Alternatives

| Option                                                             | Why not                                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An environment switch (`ENCRYPTION_ENABLED`) decided at deployment | Puts an operator's decision about data in a file only a deployer can edit, needs a restart to change, and — before the sweep existed — could neither encrypt what was already stored nor read it back once turned off           |
| Turn it on for new writes only, leaving stored rows as they are    | A panel reporting "on" over a table that is mostly plaintext is misleading, and the sweep already had every mechanism needed to move the stored rows too; encrypting them is what "on" has to mean                              |
| Make encryption mandatory rather than switchable                   | Every deployment would pay for a key it may not need; a deployment whose database already meets its confidentiality bar gains nothing from a forced switch                                                                      |
| Per-workflow encryption (some workflows encrypted, some not)       | `onboardings.context` is one shared column across every workflow; a per-workflow flag would need per-row key material tracking this version does not build                                                                      |
| Also cover connector credentials and audit payloads                | Neither is data a user inputs during onboarding — credentials are operator-supplied configuration and audit payloads describe system actions; scoping to `context` keeps the change to the data this decision is actually about |
| Deterministic encryption or a blind index for `context`            | `context` has no equality lookup that needs it, and deterministic encryption would weaken semantic security for no benefit here                                                                                                 |
| A KMS- or Vault-backed key instead of an environment variable      | Removes the last secret from configuration, but is a larger scope than this decision needed; a candidate follow-up, not a prerequisite                                                                                          |

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
defended against here.

**Neither direction is instantaneous.** Turning encryption on or off takes effect one key-ring
refresh interval later, so every engine process learns of it first, and the sweep then moves rows
a batch at a time. The panel reports how many rows are still pending and converges to zero; until
then the table is a mix of both forms, and every row reads correctly either way.

**Turning encryption off is a full decryption, by choice.** Once the sweep finishes, the database
holds plain JSON again exactly as if encryption had never been on. That is the operator's decision
to make and the panel asks for a confirmation before making it; the audit log records who made it.

**Every engine process must hold the same `ENCRYPTION_KEY` once encryption has been on.** A
process without it refuses to boot while `encryption_keys` holds any row, because every onboarding
those keys protect would be unreadable to it; one that boots against an empty table and then meets
an envelope written by a peer fails that read with an error naming the missing key.

**Losing `ENCRYPTION_KEY` makes every encrypted row unrecoverable.** There is no escrow and no
recovery path. Both the operator documentation and the engine's own bootstrap validation state it.

**Reversing this decision is the operator's call, at any time.** Turning encryption off from the
panel undoes it completely for the data; what remains is the key history in `encryption_keys`,
kept as a record of what protected the data and when.
