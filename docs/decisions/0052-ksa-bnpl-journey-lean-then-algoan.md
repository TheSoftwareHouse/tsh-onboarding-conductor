# 0052. The KSA BNPL journey links a bank through Lean and scores it through Algoan; the demo BFF is Lean's host service

- **Status:** Accepted
- **Date:** 2026-10-19 (accepted 2026-10-21, amended on implementation)
- **Tags:** workflows, demo, bff, open-banking, credit, bnpl, webhooks
- **Supersedes:** —
- **Superseded by:** —

## Decision

**One workflow, two providers.** `built-in/ksa-bnpl-lean-algoan.workflow.json` (with its `users/`
fork `-local`) runs:

1. `applicant` — `contact-details` with the two name fields, as the UK flow.
2. `credit_consent` — `consents`, key `openBankingCreditCheck`.
3. `bank_connect` — `connector-call` on `lean_bank_data`, `async`, config
   `{ minMonthlySalary: 4000, exportField: "bankDataDocument" }` (0050); declares the callback fields
   `lean-ksa` declares plus `bankDataDocument` (`file`) and `bankAccounts` (`json`, `clientVisible`),
   and marks the income fields `clientVisible` (0051).
4. `bank_data_gate` — `decision`: `bankConnectOutcome = connected` goes on to `account_selection`;
   `data_unavailable` and `not_connected` go to `manual_review`. A `decision` step routes only on a
   client submit, so the BFF submits `{}` to it itself whenever a state read lands there (a
   pass-through step the web never sees). Every linked user is scored by Algoan; Lean's salary
   verdict (`salaryThresholdMet`, consistency, employer) is shown on the result and does not route.
5. `account_selection` — `form`, `selectedAccounts` (array of `account-NN`, `clientVisible`); the
   BFF keeps its mirror of Algoan's rule and refuses a selection without the `CHECKING` account,
   now read from `bankAccounts` instead of the persona file.
6. `bank_access_consent` — `consents`, key `bankDataAccess`.
7. `credit_check` — `credit-assessment` on `algoan_credit`, `bankDataFrom: "bankDataDocument"`,
   `accountSelection: "selectedAccounts"`, the UK bands, `retry` → `account_selection`. The
   `NO_ACCOUNTS_SELECTED` refusal (0051) is a `400` the BFF maps like any field error; the web shows
   it with "Start over".
8. `manual_review`, `approved`, `declined` as the UK flow.

No IBAN verification: the national-ID check is a separate Lean product with its own test data and
does not tie to the mock-bank user; the journey starts at the widget.

**The demo BFF takes the host-service role 0049 reserved for it.** `POST /v1/bnpl/sessions/:token/bank-link`
creates (or finds) the Lean customer with `app_user_id` = the onboarding id, mints the
customer-scoped token, submits `leanCustomerId` to the engine (which parks `bank_connect`) and
answers what `Lean.connect` needs: `appToken`, `customerId`, `accessToken`, `sandbox`, the
permissions, `account_type: PERSONAL`, and success and fail redirect URLs on the demo web's public
HTTPS origin. The BFF's config gains `LEAN_CLIENT_ID`, `LEAN_CLIENT_SECRET`, `LEAN_AUTH_BASE_URL`,
`LEAN_API_BASE_URL` and `DEMO_WEB_PUBLIC_ORIGIN`; the Lean secret thus exists in the BFF's environment
and in the engine's connector settings, the duplication 0049 accepted. `bank_connect` joins the steps
the BFF owns (`submit` refuses it, naming `bank-link`), and `run` on this journey submits `{}` to the
credit step, as 0051 defines.

**The journey is selected by configuration and the web follows the steps.** `BNPL_JOURNEY`
(`uk-algoan` | `ksa-lean-algoan`) sits beside `BNPL_WORKFLOW_ID`; the BFF reports it on every
session view, and the web keeps one page-per-step table per journey. The UK journey, its simulated
bank, persona files and pusher stay as they are. On the KSA journey the pages are: details, consent,
a bank-link page, a "waiting for your bank" state while the step is parked, accounts (read from
`/state.data.bankAccounts.accounts`), the bank-access consent, processing, and a result that adds a
Lean income panel (salary average, months detected, employer, consistency, threshold) beside
Algoan's tabs. Both journeys gain a "Start over" action, in the page header on every step and as the
result page's primary action: it starts a fresh session and goes to its first page, leaving the old
onboarding where it is (parked, in review or finished) for the admin panel to show.

**No personas on the KSA journey.** The outcome is whatever the mock-bank user the applicant logs
in as actually has: Lean's test users are created in the Lean portal, the applicant types the
username and password into Lean's widget, and the engine exports that user's accounts. Nothing in
the demo selects, names or predicts a user. The record first described persona cards (a story and
an expected outcome per portal user, with usernames in a gitignored file); they were built and then
dropped on 2026-10-21 at the user's request, because a selection that decides nothing misleads. The
sandbox inventory of 2026-10-19 remains the guide to what the users look like: all from one
generator, five of seven with a detectable salary, none that looks poor.

**The ngrok static domain for the engine, a cloudflared quick tunnel for the demo.**
`pnpm demo:dev:tunnel` on the KSA journey runs one ngrok agent on `NGROK_DOMAIN` with the engine as
its upstream and a traffic policy that admits only `/v1/webhooks/*` and `/v1/health/*` (Algoan's and
Lean's callbacks; the admin panel stays off the tunnel), and one cloudflared quick tunnel to the
demo web dev server, which proxies `/v1/bnpl/*` and `/health` to the BFF so the page and its API
share one HTTPS origin (a page served over HTTPS cannot call a plain-http BFF: mixed content). The
Algoan subscriptions are recreated for the domain as today; the Lean webhook URL,
`https://<domain>/v1/webhooks/lean_bank_data/callback`, is set once in the Lean portal and never
changes. The cloudflared URL changes per run, which is harmless: the script hands it to the BFF as
`DEMO_WEB_PUBLIC_ORIGIN` (its second CORS origin and the base of the bank's redirect URLs, minted
per session) and to the web app as `VITE_BNPL_BFF_BASE_URL`, Vite allows any `*.trycloudflare.com`
host, and the demo is opened on that URL, not `localhost`, so the bank's redirect lands on the
origin the session started on. The user chose this over the single-domain path split the record
first described, because a free ngrok account has one domain and a monthly request quota the
demo's own traffic would eat into. The cloudflared quick tunnel alone stays for the UK journey.

## Context

Lean's KSA mock banks authenticate by redirect and return the customer only to an HTTPS address, and
Lean's webhook URL is portal configuration with no API, so a URL that changes per run means a portal
edit per run. The sandbox's test users come from one generator (eight accounts, a monthly payroll
pattern, random history depth per account); the inventory showed five users whose salary Lean
detects and two whose current account is too short for it, and no user that looks poor. A "declined"
outcome can therefore only come from Algoan's bands or an operator. The widget needs a token only the
holder of the Lean secret can mint, which the engine will not hand out (0049).

## Alternatives

| Option                                                                            | Why not                                                                                                                                                              |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replace the UK journey                                                            | The user chose to keep both, selected by workflow id; the UK personas remain the only deterministic declined case                                                    |
| Include `lean_iban_verification` before the widget                                | Adds a page and a hard reject that is unrelated to the mock user the applicant then logs in as; the user chose to start at the widget                                |
| Gate on `salaryThresholdMet` as well, so a thin-history user never reaches Algoan | The user wants every linked user's data to go through Algoan's bring-your-own-data flow and the result to show both verdicts; a Lean-only review would hide Algoan's |
| Persona cards naming the portal's test users and their expected outcome           | Built first, then dropped: the card decided nothing, since the widget login alone picks the data, and a choice that is not one misleads a presenter                  |
| A shaped "declined" persona overlaid on Lean's export                             | Simulated data presented as open-banking data; rejected in favour of real users, with the outcomes they actually produce                                             |
| Two cloudflared quick tunnels                                                     | The Lean webhook URL would change every run and need a portal edit each time; the user has an ngrok static domain                                                    |
| The engine mints the widget token behind `/state`                                 | 0049's recorded follow-up (a park-exposed client action); out of scope here                                                                                          |

## Consequences

The BFF holds a provider secret for the first time; `packages/demo-bff/CLAUDE.md`'s "holds no
provider credentials" becomes "holds Lean's, for the widget only". `scripts/lean-link-harness/` and
`run-ksa-lean-manual-test.sh` keep driving `lean-ksa`; the demo does not replace them. Automated
coverage splits by what each suite can reach: the engine's in-process e2e runs the whole workflow
shape on a fixture twin (`lean_bank_data` with the export against a mocked `fetch`, as
`lean-connectors.e2e-spec.ts` already does, then `mock_credit` in place of Algoan); the BFF and
Playwright journeys cover details, consent and the bank-link call with Lean mocked in the BFF
process, and stop there, because neither can drive Lean's widget nor make a separate engine process
reach a mocked Lean. The full KSA journey against both sandboxes is a manual run with a runbook,
like the UK journey's Algoan run. The result page shows every figure in SAR: Lean's insights as they
come, and Algoan's amounts converted back from the document's GBP at the same fixed rate (0050),
which the page says; the account-selection page does the same with the summary's balances.
