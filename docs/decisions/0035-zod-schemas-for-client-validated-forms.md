# 0035. Admin panel forms that check input on the client validate through a zod schema

- **Status:** Accepted
- **Date:** 2026-10-07
- **Tags:** admin-panel, frontend, forms
- **Supersedes:** [0019](0019-react-hook-form-for-admin-panel-forms.md), its "No resolver" rule only
- **Superseded by:** —

## Decision

An admin panel form that checks its input before posting states those rules once, as a `zod`
schema wired into react-hook-form with `zodResolver` from `@hookform/resolvers`, and declares no
per-field `rules`. A form whose input only the engine can judge keeps no resolver: the connector
settings cards stay as 0019 and [0020](0020-scoped-required-connector-setting-validation.md) left
them.

- The schema's output is the payload the form posts. It transforms the field values into the
  request body, so submit assembles nothing.
- The client check mirrors the engine's precondition for the call and adds no rule of its own. The
  engine stays authoritative, and its `400` is still surfaced.
- A form schema lives in its route's `utils/`, not in `src/api/`, which holds response contracts
  ([0022](0022-shared-api-tier-for-query-factories.md)).
- The first such form is `NewDraftForm`, with `app/workflows/utils/new-draft-schema.ts`.

## Context

`NewDraftForm` ([0034](0034-admin-authored-workflow-drafts.md)) is the first panel form that
validates on the client. It has to: an uploaded file is parsed before anything can be posted, and
a missing `id` or `version` belongs on the field, not in a toast. Under 0019 it carried three
hand-written `validate` rules, and the upload parser repeated the same `id` and `version` checks.
0019 refused a resolver because the engine owns connector settings validation and a client copy
would drift. That reason does not hold here: the copy already existed, and a schema puts it in one
place.

## Alternatives

| Option                                                   | Why not                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Hand-written `rules` per field (the status quo)          | The same rules spread across the fields and the upload parser, and submit assembles the payload by hand             |
| A hand-written resolver instead of `@hookform/resolvers` | About ten lines re-implementing what the package already does                                                       |
| No client validation; show the engine's `400` as a toast | Field errors belong on the field, not in a toast, and an upload must be parsed before anything can be posted anyway |

## Consequences

The panel gains `@hookform/resolvers` (5.9.1). `TextFormField` takes react-hook-form's
transformed-values type parameter, for a form whose submitted values differ from its field values.
The panel restates engine limits (`MAX_WORKFLOW_ID_LENGTH`, `MAX_DRAFT_VERSION`), which can drift
from the engine's; the engine still checks every save, so drift surfaces as a server-side `400`,
never as bad data. Reversing this turns one schema file back into field rules.
