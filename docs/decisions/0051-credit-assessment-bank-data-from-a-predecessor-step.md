# 0051. The `credit-assessment` step can take its bank data from an earlier step and narrow it to the accounts the applicant selected

- **Status:** Accepted
- **Date:** 2026-10-19 (accepted 2026-10-21, amended on implementation)
- **Tags:** step-types, workflows, documents, credit, bnpl, authoring
- **Supersedes:** —
- **Superseded by:** —

## Decision

**`bankDataFrom` replaces the upload.** The `credit-assessment` step's config gains an optional
`bankDataFrom: "<fieldName>"`. When set, the step declares no `bankData` upload field of its own,
refuses `bankDataMaxSizeBytes` (there is no reserve to validate), and compiles its connector's
`fieldMapping` as `bankData: <fieldName>`. The named field must be a `file` field of a step that is a
guaranteed predecessor, which the DDL's existing cross-step rule already enforces for connector
inputs, so a document can only come from a step every path passes through. The step stays
`awaiting_user`: with no input to give, the client starts the assessment by submitting `{}` on it,
and a `retry` edge that returns to it is re-submitted the same way. Without `bankDataFrom` nothing
changes: the step owns the upload exactly as 0047 describes.

**`accountSelection` narrows the document.** A second optional key, `accountSelection: "<fieldName>"`,
names an `array` field (of `text`) that a guaranteed-predecessor form step collects, holding account
positions in the demo's `account-NN` form. The step compiles it as `fieldMapping.accountSelection:
<fieldName>`, so the value reaches the kernel's payload under a key the kernel owns. The kernel, in
`buildCreditSubmission`, parses the document as JSON, keeps the positions of the top-level `accounts`
array the selection names (a position past the end is ignored), and submits the narrowed document to
the provider. An empty result is not a provider call: the kernel answers retryable invalid data on
the selection's source field (`selectedAccounts: ["NO_ACCOUNTS_SELECTED"]`, a `400 INVALID_STEP_DATA`)
and the onboarding stays on the credit step. The record first asked for a failed assessment routed
on `retry`, but a connector's synchronous `execute` can only accept, refuse or park — it writes no
step field and takes no transition — so a verdict without a provider call has nothing to carry it,
and inventing one was out of scope. The client cannot resubmit the selection from the credit step,
so a host service shows the error and offers a fresh start; the demo BFF mirrors the rule before
the selection is ever submitted, which keeps the path unreachable from the demo web. This is the
first and only shape the kernel assumes of a bank-data document: a JSON object with a top-level
`accounts` array, ordered. Everything else stays the provider's to validate, as 0045 has it.

**Field visibility follows the journey.** A workflow that shows Lean's income verdict on its result
marks the `bank_connect` step's `bankConnectOutcome`, `salaryMonthlyAverage`,
`salaryMonthsDetected`, `salaryConsistent`, `salaryThresholdMet` and `employerName` as
`clientVisible` in its own document; the `lean-ksa` fixture is not changed. `/state` exposes them
through 0046 with no engine change.

## Context

The combined journey (0052) has two providers in sequence: Lean produces the document (0050) in a
step that parks and resumes on a webhook, and Algoan scores it several steps later, after the
applicant has picked accounts and consented. Today the credit step's only input is a client upload,
and the demo's account selection is applied by the BFF before it uploads the persona file. With the
engine holding the document, the narrowing has to happen in the engine too, after the selection step
and before the provider call, and it must not depend on which provider scores.

## Alternatives

| Option                                                            | Why not                                                                                                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Let `lean_bank_data` export only the selected accounts            | The export happens on Lean's webhook, before the applicant has seen the accounts; a second export after the selection would need a second park |
| Narrow in the Algoan provider's `validateBankData`                | The selection is provider-neutral; `mock_credit` and the next provider would each reimplement it                                               |
| A separate `select-accounts` step type that rewrites the document | A step type cannot write documents (0011: a type never reaches the engine), and a form step with an `array` field already collects the choice  |
| Drop account selection from the journey                           | The user chose to keep the page; Lean's widget consent does not let the applicant exclude an account                                           |
| Make the step auto-run when `bankDataFrom` is set                 | A step that transitions without a submit has no precedent in the DDL; `decision` steps also route only on a client submit                      |
| A failed assessment on an empty selection, routed on `retry`      | Needs a synchronous connector result that writes fields and transitions, which the executor has no shape for; a field error is what exists     |

## Consequences

The step type's schema and `docs/IMPLEMENTATION.md` §2.1 gain the two keys. The kernel narrows the
document bytes in `buildCreditSubmission` (a JSON parse it performs only when a selection is mapped),
so `CreditSubmission` is unchanged and every provider receives a document in the shape it already
validates. The DDL's mapping rule checks that the named fields exist, persist and belong to a
guaranteed predecessor; it does not check their types, so a `bankDataFrom` naming a non-file field is
caught at the first submit (no completed document resolves, `invalid()`), not at load. The
`credit-check` fixture and the UK workflow are untouched. A document whose `accounts` member is not
an array fails the submission as `INVALID_BANK_DATA`, the existing client error.
