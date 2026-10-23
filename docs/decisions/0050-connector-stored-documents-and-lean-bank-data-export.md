# 0050. A connector may store a document for a later step, and `lean_bank_data` exports the linked accounts as one

- **Status:** Accepted
- **Date:** 2026-10-19 (accepted 2026-10-21, amended on implementation)
- **Tags:** connectors, open-banking, documents, credit, bnpl, storage
- **Supersedes:** —
- **Superseded by:** —

## Decision

**The engine gains one internal way for a connector to produce a document.** `ConnectorDocumentStore`
(in `connectors/documents/`, beside the resolver that reads the same table — `onboardings/` imports
`connectors/`, so a store there would close a module ring) takes an onboarding id, the step that is parked,
a field name, a content type and a byte buffer, writes the object straight to the final key the
upload flow would have promoted it to (`ObjectStoragePort` gains `putObject`, answering the etag),
and inserts an `onboarding_documents` row already `completed`: staging key equal to the final key,
requested and verified content type equal, verified size and etag from the write, `completedAt` set.
No migration: the row shape is unchanged, and a connector-written document differs from an uploaded
one only in never having been pending. `CompletedOnboardingDocumentResolver` and the file-field
replay of a continuation therefore work unchanged, because the row is keyed by the onboarding, the
parked step's name and the field the step declares for it.

**`lean_bank_data` uses it when the declaration asks for it.** A new optional `config.exportField`
names a field of the `bank_connect` step, of type `file`. When present, a finished refresh (and an
operator reconcile that finds an entity) pulls, after the income and employment insights, the
entity's accounts (`GET /data/v2/accounts`), each account's balances and each account's
transactions over `LEAN_INSIGHTS_LOOKBACK_MONTHS` (six months, paged by 100), converts them to the
bank-data document the credit kernel's Algoan provider accepts, stores it through the store under
that field, and adds two keys to the callback fields: `<exportField>` = the document id, and
`bankAccounts` = a client-visible summary of the exported accounts for an account-selection page, a
`json` field (the DDL's open shape is an object, never a bare array) holding `{ accounts: [{ id,
type, name, accountNumber, balance, currency, bankName }] }`, with `accountNumber` the last four
characters of the IBAN and `balance` already in the document's currency. A step that declares
`exportField` must declare both fields: the two keys are not in the adapter's static
`callbackFields` (the registry holds every async step to that list, and `lean-ksa` does not export),
so the engine cannot check the declaration at load, and a callback carrying an undeclared key is
refused as `UNKNOWN` field data, leaving the park in place. The `file` field is declared with
`when: { field: "bankConnectOutcome", equals: "connected" }`, because a `file` field is always
`required` and the client's own submit of `leanCustomerId` must not have to carry it. A Lean refusal
of the entities, accounts, balances or transactions read is the same `bankConnectOutcome:
data_unavailable` an insights refusal is: no document, nothing decided from a partial read; so is an
export in which no account is eligible (no personal SAR current or savings account), since nothing
could be scored. The store refuses a document over `CONNECTOR_DOCUMENT_MAX_BYTES` (1 MiB, the credit
step's default upload cap), because a `file` field's upload validation is enforced at reserve and a
connector-written document never passes through one; over the cap is `data_unavailable` too.

**The document shape is the one `algoan_credit` validates**, `{ accounts: [...] }`, the same shape
the demo's persona files carry, so a credit step can consume it with no provider change:

| Lean                                                                                           | Document                                                                                            |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `account_sub_type` `CURRENT` / `SAVINGS`, `account_type` `PERSONAL`, `currency` `SAR`          | `type` `CHECKING` / `SAVINGS`, `usage` `PERSONAL`; any other sub type, currency or usage is dropped |
| `account_holder_name`; the `IBAN` identification                                               | `owners[0].name`; `iban`                                                                            |
| the entity's `bank_identifier` and `bank_details.name` (from the customer's entity listing)    | `bank.id`, `bank.name`                                                                              |
| balance of type `INTERIM_AVAILABLE`, else `CLOSING_AVAILABLE`, else the first; `DEBIT` negates | `balance`; `balanceDate` = the balance's `date_time`, else the export time                          |
| transactions with `status` `BOOKED`; `amount.amount` negated for `DEBIT`                       | `transactions[].amount`                                                                             |
| `transaction_information`                                                                      | `description` (the raw bank label Algoan's categoriser is built for, not Lean's cleansed one)       |
| `booking_date_time`, `value_date_time`                                                         | `dates.debitedAt`, `dates.bookedAt`                                                                 |
| `account_sub_type`                                                                             | `name`: "Current account" or "Savings account"                                                      |

Accounts keep the order Lean lists them in; the summary's `id` is the position, `account-01`,
`account-02`, … (the demo's existing convention), so the document carries nothing beyond the shape
the provider expects and a selection names a position, never an account number.

**Amounts are converted to GBP at a fixed rate.** Every `amount` and `balance` is multiplied by
`SAR_TO_GBP_RATE = 0.197` (the mid-market rate on 2026-10-19), rounded to two decimals, and the
document declares `currency: "GBP"` on accounts and transactions. The constant lives in the
converter with its date. Algoan's models are per country and SAR is not among them; GBP is what the
`algoan_credit` provider config defaults to and what the sandbox has been measured with. This is a
demo compromise, stated as such in `docs/IMPLEMENTATION.md`.

## Context

The combined KSA journey (0052) needs Algoan to score the accounts Lean linked. `lean_bank_data`
today reads only income and employment aggregates and, by design, lets no transaction, balance or
account number leave the adapter. The credit kernel reads its `bankData` from a completed document
(0047), and the only way to complete one today is the client's reserve → upload → complete flow,
which a server-side connector cannot drive. Lean's data API (`/data/v2/accounts`,
`/accounts/{id}/balances`, `/accounts/{id}/transactions`) returns everything Algoan's bring-your-own-data
format needs, and the sandbox inventory of 2026-10-19 showed each mock user with eight accounts, up
to a year of transactions, a monthly payroll pattern and a USD account that must be dropped.

## Alternatives

| Option                                                                                                     | Why not                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The BFF pulls Lean's data with its own credentials and uploads the document as today's persona pusher does | The orchestrator would carry nothing between its two providers; the demo would be two unrelated connectors with a hand-off in a showcase service. The user chose the engine |
| A provider-neutral intermediate document format, converted again by each credit provider                   | A second format with one producer and one consumer; the Algoan shape already is the plain "accounts with transactions" document, and 0045 lets a provider validate its own  |
| Emit the document through the client upload flow by minting a reservation internally                       | The reserve → inspect → promote path exists for untrusted uploads; a connector writing its own bytes needs none of it and would leave a `pending` row to expire             |
| Keep SAR and configure `providerConfig.currency: SAR`                                                      | Algoan's models are per local currency and do not cover SAR; the user chose a conversion to real GBP values over a relabel                                                  |
| The exchange rate in the workflow's connector `config`                                                     | A rate is not a lender's policy and would suggest a precision the demo does not have; the user asked for a hard-coded constant                                              |
| Lean's `description_cleansed` as the transaction label                                                     | Algoan categorises raw bank labels; the cleansed text is Lean's own category output and would be double enrichment                                                          |

## Consequences

`ObjectStoragePort` gains a write; the S3 driver, the only one, implements it. `lean_bank_data`'s
settings are unchanged; the export is opt-in per declaration, so `lean-ksa` and its tests keep
reading insights only. A linked user's transactions now leave Lean and are retained under the
onboarding's documents with the usual lifecycle; the audit row for the callback still carries only the
declared fields (a document id and the account summary), never the document. The export adds three
Lean reads per account to a finished refresh; the webhook handler already runs the insights reads
inline, and the six-month window keeps a mock user's largest account under a thousand transactions.
`docs/IMPLEMENTATION.md` gains the export, the mapping table and the rate; `docs/EXTENDING.md` gains
the store as a connector extension point.
