# Example workflows

**None of these are production workflows.** Each file demonstrates one
connector or one engine feature so it can be read in isolation; they are named
after the mechanism they exercise, not after a business process. A real
onboarding is defined by whoever operates the engine and mounted at
`WORKFLOWS_DIR` — see the Workflow Directory section of the root `README.md`.

The engine's end-to-end suite owns a separate frozen copy of these files under
`packages/engine/test/fixtures/workflows/`. Changing an example here does not
affect the tests, and vice versa.

| Workflow                                           | Demonstrates                                 | Connector tier |
| -------------------------------------------------- | -------------------------------------------- | -------------- |
| `base.workflow.json`                               | Multi-step flow with boolean/text fields     | sandbox        |
| `conditional-fields-and-transitions.workflow.json` | Conditional fields and branching transitions | sandbox        |
| `email-otp.workflow.json`                          | Email OTP generate/verify                    | sandbox        |
| `sms-otp.workflow.json`                            | SMS OTP generate/verify                      | sandbox        |
| `file-upload.workflow.json`                        | Document upload and forwarding               | sandbox        |
| `manual-review.workflow.json`                      | Manual transitions with no connector         | none           |
| `http-request.workflow.json`                       | Generic outbound HTTP call                   | production     |
| `sendgrid-email.workflow.json`                     | SendGrid dynamic template send               | production     |
| `twilio-verify.workflow.json`                      | Twilio Verify start/check                    | production     |
| `manual-smtp.workflow.json`                        | SMTP send with an HTML template              | production     |

"Connector tier" refers to the connectors a workflow declares. Workflows in the
sandbox rows depend on connectors that exist only for local development and
testing.

The production-tier examples still are not deployable as-is —
`http-request.workflow.json` posts to the reserved placeholder host
`api.example.com`, and `sendgrid-email.workflow.json` has a single success
transition with no failure branch.
