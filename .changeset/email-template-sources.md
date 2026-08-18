---
'@tsh/engine': minor
---

Give email templates their own three-source structure and scope resolution to the declaring workflow's source.

Templates previously lived inside the workflow directories and were resolved by trying each workflow source in turn, first hit wins. A template was therefore not tied to the workflow that declared it: once the engine ships a built-in workflow with a template, a user workflow referencing the same relative path would silently be served the built-in file instead of its own.

- Templates move out of `workflows/*/templates/` into a parallel `email-templates/` tree with the same three sources: `packages/engine/email-templates/built-in`, `packages/engine/email-templates/fixtures`, and `EMAIL_TEMPLATES_DIR` for the operator's own.
- `ConnectorExecutionInput.execution` gains `workflowSource`, supplied by `Workflow` from the source the registry loaded it out of. Connectors can now resolve source-scoped assets.
- `smtp_email` resolves a `templatePath` inside **one** root — the one belonging to its own workflow's source — with no cross-source fallback. Escaping that root is still refused.
- A user workflow that declares a `templatePath` while `EMAIL_TEMPLATES_DIR` is unset now throws `SmtpEmailUnavailableException`: the operator never mounted a template directory, which is a misconfiguration rather than a bad submission.

**Breaking:** `ConnectorExecutionContext` requires `workflowSource`. Any code constructing a connector execution input must supply it. `Workflow` takes the source as a third constructor argument, defaulting to `user` — the least-privileged source, so a workflow built without provenance fails closed instead of reaching into anything shipped with the engine.

**Breaking:** a `templatePath` is now relative to the template root rather than to the workflow directory. The `manual-smtp` fixture changed from `templates/manual-smtp.html` to `manual-smtp.html`.
