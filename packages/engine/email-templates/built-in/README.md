# Built-in email templates

Email templates for the built-in workflows, shipped inside the engine package.
A `templatePath` on a connector in a **built-in** workflow resolves inside this
directory and nowhere else.

**This directory is currently empty** because the engine ships no built-in
workflows yet.

This path is fixed and not configurable. The parallel directories are
[`../fixtures/`](../fixtures/) for fixture workflows, and whatever
`EMAIL_TEMPLATES_DIR` points at for the operator's own workflows.
