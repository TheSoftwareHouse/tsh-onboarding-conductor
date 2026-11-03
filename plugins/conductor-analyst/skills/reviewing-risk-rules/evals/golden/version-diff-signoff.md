# Sign-off summary: eu-b2c-individual-kyc-eea, version 1 to version 2

Source: `diff_workflow_versions` (workflowId `eu-b2c-individual-kyc-eea`, from 1 to 2).

Risk rules and thresholds: the diff reports no change to score rules, score bounds or any
threshold. This is not a scoring change.

What did change:

- The workflow name now ends with "(specialized steps)".
- A step `send_phone_code` is added.
- `collect_contact`: its success transition now goes to `send_phone_code` (it went to
  `verify_phone_code` before), and the rejected transition to `rejected` is removed.
  The connector `twilio_sms_otp` is removed from this step.
- `submit_kyc`: gains the field `kycAttemptCount`.

Not changed: score rules and thresholds, steps not listed above.

Nothing here is live because of this summary; both versions are already published.
