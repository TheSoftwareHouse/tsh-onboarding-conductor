# Risk scoring in analyst-investigation (version 1)

Source: `get_workflow_version` for `analyst-investigation` version 1.

There is one score, `risk`, bounded 0 to 100. Every onboarding starts at 0. Three rules add points
on the `collect_profile` step, when the applicant submits their profile:

- `country` is RU, IR, TR or AE: +40
- `pepSelfDeclared` is true (the applicant declares a politically exposed person): +30
- `sourceOfFunds` is `sale_of_asset` or `other`: +20

The matching rules are summed and clamped to 0..100 once. The maximum possible is 90.

The threshold is on the `success` transition of `collect_profile`: when `risk` is greater than or
equal to 60, the onboarding goes straight to `rejected`. Otherwise (the fallthrough) it continues
to `send_email_code`.

Combinations, by arithmetic on the rules:

- country + PEP = 70, rejected
- country + source of funds = 60, rejected
- country + PEP + source of funds = 90, rejected
- PEP + source of funds = 50, continues
- any single rule (40, 30 or 20) continues

The score is used only for this one routing decision. What happens after it is decided by other
steps: the e-mail code check, the provider's identity verdict at `check_identity` (approve,
review, rejected) and the manual decision at `review_identity`.
