# Fixture email templates

Email templates for the fixture workflows. A `templatePath` on a connector in a
**fixture** workflow resolves inside this directory and nowhere else — there is
no fallback to the built-in or operator template roots, so a template here can
never be served to a user workflow that happens to use the same relative path.

`manual-smtp.html` backs `workflows/fixtures/manual-smtp.workflow.json`.

Development and test only, and the path is fixed rather than configurable. See
[`../built-in/`](../built-in/) and `EMAIL_TEMPLATES_DIR` for the other two roots.
