# Email Templates

HTML templates rendered by email connectors. Each scope is a separate
directory, and workflows address a template with a scope-prefixed
`templatePath` such as `fixtures/manual-smtp.html`.

| Scope      | Directory   | Purpose                                                     |
| ---------- | ----------- | ----------------------------------------------------------- |
| `built-in` | `built-in/` | Templates shipped with the application.                     |
| `fixtures` | `fixtures/` | Example templates backing the checked-in example workflows. |
| `users`    | `users/`    | Your own templates.                                         |

`built-in/` and `fixtures/` resolve relative to the repository root and are not
configurable. Only `users/` can be relocated, with the optional
`EMAIL_TEMPLATES_USERS_DIR` environment variable; unset, it defaults to
`email-templates/users`.

Paths are resolved inside their own scope directory. A `templatePath` that is
absolute, omits a known scope prefix, or traverses out of its scope is
rejected.

Placeholders use `{{variableName}}` and are filled from the connector's mapped
payload fields. Values are HTML-escaped before insertion.
