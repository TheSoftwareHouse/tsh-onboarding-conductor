---
'@tsh/engine': minor
---

Rename the MailHog-specific SMTP connector to a generic `smtp_email` connector and fix its failure classification.

The adapter was never MailHog-specific — it is a nodemailer transport driven entirely by `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_STARTTLS`, `SMTP_USERNAME`/`SMTP_PASSWORD` and `SMTP_TIMEOUT_MS`. Only its name and the local defaults pointed at MailHog.

**Breaking:** the connector `type` changed from `smtp_mailhog` to `smtp_email`. Workflow definitions mounted at `WORKFLOWS_DIR` must be updated. Existing audit records keep the old `connectorType` value.

**Fix:** transport failures (connection resets, timeouts, auth failures) and operator misconfiguration (`SMTP_ENABLED=false`, missing host/port/timeout, invalid `SMTP_FROM`) previously resolved to `rejected('CONNECTOR_REJECTED')` or an `invalid-data` field error. A network blip therefore terminated the onboarding, and an operator's misconfiguration was reported to the applicant as a bad field. Both now throw `SmtpEmailUnavailableException`, matching how the SendGrid and Twilio connectors already signal outages. Genuine per-recipient rejections from the SMTP server still resolve to `rejected`.
