# Fixture workflows

**Development and test only.** These workflows exist to exercise the engine, not
to onboard anyone. They load only when `FIXTURE_WORKFLOWS_ENABLED=true`, which
`AppConfig` refuses under `NODE_ENV=production`, so a production engine cannot
load them even by accident. This directory's path is fixed — it ships inside the
engine package and is not configurable.

Each file demonstrates one connector or one engine feature so it can be read in
isolation; they are named after the mechanism they exercise, not after a
business process. The engine's unit and e2e suites load this directory directly,
so changing a file here can break tests.

The other two workflow sources are [`../built-in/`](../built-in/) (production
workflows shipped with the engine — none yet) and the operator's own directory,
configured through `WORKFLOWS_DIR`. See the Workflow Sources section of the root
`README.md`.

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
sandbox rows depend on connectors that only exist when
`SANDBOX_CONNECTORS_ENABLED` is set, which `AppConfig` refuses under
`NODE_ENV=production`. Pointing a production engine at one of them fails at
startup rather than at the first applicant to reach the step.

Even the production-tier rows are not deployable as-is —
`http-request.workflow.json` posts to the reserved placeholder host
`api.example.com`, and `sendgrid-email.workflow.json` has a single success
transition with no failure branch.
