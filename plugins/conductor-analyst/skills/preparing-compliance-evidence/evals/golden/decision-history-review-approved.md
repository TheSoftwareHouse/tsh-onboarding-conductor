# Decision history of onboarding {{manifest:review-approved-01}}

## 1. Scope and period

One onboarding, `{{manifest:review-approved-01}}`, whole history (no period given, so none applied).

## 2. Sources

- `search_audit` with `onboardingId` = `{{manifest:review-approved-01}}`, retrieved at the time the
  session reports. `truncated` false, so the history is complete as the log holds it.

## 3. Summary

The onboarding was started, passed through its steps, was sent to manual review, and a manual
review decision approved it. That decision is recorded with actor `system` / `engine`: the trail
does not identify the reviewer.

Expected explanation, from the seed manifest: {{manifest:review-approved-01.explanation}}

## 4. Findings

| Time (UTC)      | Action                            | Actor           | Detail                                                                      |
| --------------- | --------------------------------- | --------------- | --------------------------------------------------------------------------- |
| (from the tool) | onboarding.started                | system / engine | to awaiting_user at collect_profile                                         |
| ...             | onboarding.state_transition       | system / engine | step by step to check_identity                                              |
| ...             | webhook.inbound_callback_applied  | system / engine | provider verdict `review`                                                   |
| ...             | onboarding.state_transition       | system / engine | check_identity to review_identity, awaiting_manual_review                   |
| ...             | onboarding.manual_review_decision | system / engine | review_identity, awaiting_manual_review to approved, trigger manual.approve |

Who decided: not identified. The manual review route is not authenticated, so the engine records
the decision under `system` / `engine`.

## 5. Limitations

- The audit log is not cryptographically tamper-evident, and some observations are best effort.
- The reviewer is not identified for any manual review decision (decision record 0021); do not
  attribute it to whoever was active at the time.
- Admin access is attributable to an operator only when sign-in is enabled.
- Exports are audited under the analyst, including the assistant's own reads.
- No truncation in this read.

## 6. Appendix: tool calls

1. `search_audit` { onboardingId } returned the entries above, `truncated` false.
