# Proposal shown to the analyst, waiting for a yes

Sources: `get_workflow_version`, `get_workflow_document` (authored document, no redactions),
`onboarding_stats` / `find_onboardings`, `compile_workflow`, `create_workflow_draft` called
without a token (preview).

Change: on the success transition of `collect_profile`, the reject threshold goes from
`risk >= 60` to `risk >= 70`. Nothing else in the document changes.

Target: analyst-investigation is a `fixtures` family, and drafts can only be added to families
in the `users` scope (the preview of a draft under that id returns the blocker
WORKFLOW_SCOPE_CONFLICT), so the draft goes into a new family, for example
`analyst-investigation-risk-70`, version 1, named "Analyst investigation (reject at 70)". The
preview says `wouldCreateFamily: true` in scope `users`.

Compile result: ok, 10 steps. Blockers: none.

Impact on the existing population (historical): of 46 onboardings, 4 were rejected by the score
(60, 70, 70, 90); one, at 60, would have continued instead of being rejected.

Question: do you want me to save this as a draft? (yes / no). Nothing has been saved. Even if
saved, a draft starts no onboarding and publishing is done by an authorised person in the
admin panel.
