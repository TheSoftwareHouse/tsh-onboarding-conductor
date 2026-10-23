---
id: bnpl-credit-check
title: UK BNPL credit check
sidebar_label: UK BNPL credit check
description: Score a UK customer's open-banking data through the engine with Algoan - the API flow, the connector settings, the demo personae, the webhook setup and what to check when it stalls.
---

→ The `uk-bnpl-credit-check-algoan` workflow takes a customer's bank data, has [Algoan](https://docs.algoan.com) score it and routes the onboarding on the result: approved, manual review or declined. The engine talks to Algoan; the client never does. This guide covers the client flow, the settings, the demo data, the one webhook that needs a public address, and the failures worth knowing.

The workflow ships as [`uk-bnpl-credit-check-algoan`](/fixtures/uk-bnpl-credit-check-algoan). Its twin [`credit-check`](/fixtures/credit-check) runs the same shape on the `mock_credit` provider, with no network and no credentials, which is what the end-to-end suite uses.

## The steps

| Step                   | Type                | What happens                                                                                                                                                 |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `applicant`            | `contact-details`   | First name, last name, email. Collected for the operator; not sent to Algoan.                                                                                |
| `credit_consent`       | `consents`          | The open-banking credit-check consent (`openBankingCreditCheckConsent`).                                                                                     |
| `bank_selection`       | `form`              | Which bank the customer chose: `bankId` and `bankName`.                                                                                                      |
| `bank_connection`      | `form`              | That a (simulated) bank connection was made: `bankConnectionReference` (opaque, never a password), `bankConnectionMethod` (`qr` or `device`), `bankProfile`. |
| `account_selection`    | `form`              | `selectedAccounts`: the opaque ids (`account-01`, `account-02`) of the accounts to analyse, one to ten.                                                      |
| `bank_access_consent`  | `consents`          | The bank's authorisation: `bankDataAccessConsent`.                                                                                                           |
| `credit_check`         | `credit-assessment` | Takes one `bankData` document, starts the analysis, parks until Algoan answers.                                                                              |
| `manual_review`        | `manual-review`     | Where a mid score waits for an operator.                                                                                                                     |
| `approved`, `declined` | `terminal`          | The two ways it ends.                                                                                                                                        |

The four bank steps are bookkeeping. Algoan Connect is not available on the project, so the bank itself is simulated by the demo app; the engine only records what the customer did. Nothing about an account beyond its opaque id enters the onboarding's context: no IBAN, no balance. `bankId`, `bankName`, `bankProfile` and `selectedAccounts` are `clientVisible`, so `/state` returns them; `bankConnectionReference` is not.

The `credit_check` step has four ports: `approved`, `review` (to `manual_review`), `declined` and `retry` (back to `account_selection`). Scores are banded by the step's `bands` config, `approveFrom: 700` and `reviewFrom: 400`: at or above 700 is approved, 400 to 699 is review, below 400 is declined. A failed analysis is `retry` until `maxAttempts` (3) is reached, then `review`. The workflow also sets `webhook.notify.path: notify`, so the engine posts `onboarding.state_changed` to your service whenever the onboarding moves.

## The client flow

The first six steps are ordinary submits, as in [Your first onboarding](./your-first-onboarding.md). The seventh, `credit_check`, differs: the step owns one input, `bankData`, a `file` field that accepts `application/json` up to 1 MiB. The ids in `selectedAccounts` are positions in whatever file you upload next: the engine does not check them against it, so a client that pushes bank data must push only the accounts it recorded. Bank data never goes in a submit body. It travels as an uploaded document, so the client reserves it, uploads it straight to object storage, completes it, then submits the step with the document id.

1. `POST /v1/onboardings` with `{"workflowId":"uk-bnpl-credit-check-algoan"}`.
2. Submit, in order, each as `POST /v1/onboardings/{id}/submit` (every one answers `201` with the next `currentStep`):
   - `applicant`: `{"firstName":"Sherlock","lastName":"Holmes","email":"sherlock@example.com"}`
   - `credit_consent`: `{"openBankingCreditCheckVersion":"2026-10","openBankingCreditCheckConsent":true}`
   - `bank_selection`: `{"bankId":"algoan_demo_bank","bankName":"Algoan Demo Bank"}`
   - `bank_connection`: `{"bankConnectionReference":"3f9c2a7e5b1d4c8a9e0f6b2d7a1c4e55","bankConnectionMethod":"device","bankProfile":"high"}`
   - `account_selection`: `{"selectedAccounts":["account-01","account-02"]}`
   - `bank_access_consent`: `{"bankDataAccessVersion":"2026-10","bankDataAccessConsent":true}`
3. `POST /v1/onboardings/{id}/documents` with `{"field":"bankData","contentType":"application/json","sizeBytes":<n>}`. The response carries `documentId` and a presigned `upload` form (`upload.url`, `upload.fields`).
4. Send the file to `upload.url` as a multipart form with `upload.fields` first and the file last. Storage answers `204`.
5. `POST /v1/onboardings/{id}/documents/{documentId}/complete` with `{}`. The engine reads the object back and checks its size and content type.
6. `POST /v1/onboardings/{id}/submit` with `{"bankData":"<documentId>"}`.

The submit returns while Algoan is still computing; the onboarding is parked on `credit_check`. Read `GET /v1/onboardings/{id}/state` to follow it:

- `pending` is `{ connectorId, parkedAt }` while the provider works and `null` afterwards. Render "processing" from it.
- `data` holds the values the credit step exposes to the client: `creditOutcome`, `creditScore`, `creditScoreBand`, `creditIndicators`, `creditSecondaryScores` and `creditReport`.
- `currentStep` moves to `approved`, `declined`, `manual_review` or, on a failed analysis, back to `account_selection`.

`onboarding.state_changed` carries no outcome; re-read `/state` when it arrives. In the sandbox Algoan completes in one to three seconds and its webhook arrives within a second after that.

:::note The report
`creditReport` is the analysis assembled by the engine: `scores`, `metadata`, `creditInsights` with every `transactions` array removed, `accounts`, `essentials` and the first page of `transactions`. It is capped at 262 144 bytes of compact JSON; in the sandbox the three personae come to roughly 43 KB and 69 KB. A step configured with `report: "summary"` keeps only `scores` and `metadata`, and `"none"` omits it.
:::

## What the engine does at Algoan

For one attempt the engine makes these calls, so you can recognise them in logs:

| Call                                                                                                           | Notes                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/oauth/token`                                                                                         | Form-encoded `client_credentials`; the token lives 86 400 s and is cached.                                                                                            |
| `POST /v2/customers` with `{ customIdentifier }`                                                               | The identifier is the onboarding id. A second use answers `422 ALREADY_EXISTS`; the engine then looks the customer up with `GET /v2/customers?filter=` and reuses it. |
| `POST /v2/customers/{customerId}/analyses`                                                                     | `format: "ALGOAN"`, `dataOrigin: "OPEN_BANKING"`, the uploaded `accounts`. Answers `201 { id, status: "CREATED" }`.                                                   |
| Webhook `analysis_completed` / `analysis_failed`                                                               | `payload` is `{ customerId, analysisId }`. The body never carries the result.                                                                                         |
| `GET …/analyses/{analysisId}` and `/scores`, `/credit-insights/*`, `/transactions`, `/accounts`, `/essentials` | Read back after the webhook, or by reconcile. `COMPLETED` scores, `ERROR` fails, anything else keeps waiting.                                                         |

One customer exists per onboarding and one analysis per attempt. The park records `<customerId>/<analysisId>`, and a callback for any other analysis is set aside.

## The connector settings

Store the project's credentials once, through the admin panel (Connectors, `algoan_credit`) or the API. A fresh clone runs with `ADMIN_AUTH_ENABLED=false`, so no token is needed locally.

```bash
$ curl -X PUT localhost:3000/v1/admin/connectors/algoan_credit \
    -H 'Content-Type: application/json' \
    -d '{"settings":{"clientId":"<client id>","clientSecret":"<client secret>","callbackSigningSecret":"<openssl rand -hex 32>"}}'
```

| Setting                 | Secret | Meaning                                                                                                        |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `clientId`              | no     | The Algoan project's API client id.                                                                            |
| `clientSecret`          | yes    | The matching client secret.                                                                                    |
| `callbackSigningSecret` | yes    | The secret the webhook subscriptions are created with. A value you generate; never the same as `clientSecret`. |

Secrets come back masked and are never read from the environment by the engine. `ALGOAN_API_BASE_URL` (default `https://api.algoan.com`) and `ALGOAN_TIMEOUT_MS` (default 10000) are deployment settings in `.env`, only worth changing for a proxy or a slow network.

## The demo personae

The repository ships four bank-data files in `packages/demo-bff/personas/en/`: three personae for the Algoan sandbox, and a hidden fourth, `fail_case.json`, for the retry path. Each of the three is one `{ accounts: [...] }` document with two `PERSONAL` GBP accounts at "Algoan Demo": a `CHECKING` account and a `SAVINGS` account (two to five transactions, a 90-day window cannot hold more monthly lines). The demo's account-selection step lets the customer pick which are analysed; the analysis needs the `CHECKING` one. Scores measured against the sandbox on 2026-10-15 (credit score version `1.0.0`, payment score `1.1.0`); the same data pushed twice returns the same score, and the savings account leaves every score unchanged, so the numbers hold with both accounts and with the checking account alone.

| File                   | Accounts             | Credit score | Payment score | Band                      | Outcome         |
| ---------------------- | -------------------- | ------------ | ------------- | ------------------------- | --------------- |
| `sherlock_holmes.json` | Checking and savings | 965          | 10            | `approve` (700 and above) | `approved`      |
| `james_watson.json`    | Checking and savings | 598          | 3             | `review` (400 to 699)     | `manual_review` |
| `james_moriarty.json`  | Checking and savings | 362          | 2             | `decline` (below 400)     | `declined`      |

`fail_case.json` ("Fail Case", one current account with two transactions) is test-only: it is not offered at the bank's login and was not measured against the sandbox. The `mock_credit` provider fails its analysis by the owner's name, which is what the end-to-end suite uses to walk the `retry` loop; the web app reaches it through the unlinked `/start/fail_case` link.

Sherlock and Watson are the MIT-licensed samples from [algoan/fake-open-banking-data](https://github.com/algoan/fake-open-banking-data); the upstream README calls Watson "below 100", but the sandbox model scores him 598. Moriarty was derived from Watson's file in this repository and calibrated to land below 400. Scores drift slowly as the 90-day window moves; the bands stay well apart.

The three indicators of the credit score (`livingStandard`, `budgetManagement`, `financialEvolution`, each from -5 to 5) come back as 3 / 4 / 1 for Sherlock, -3 / 5 / 2 for Watson and -5 / 0 / 4 for Moriarty.

### Re-base the dates before pushing

Algoan disregards transactions older than 90 days before the balance date, and the persona files keep upstream dates. Pushed unchanged they give a thin window and a different score. Shift every `balanceDate` and every `transactions[].dates.*` by `today - max(balanceDate)` first:

```bash
$ node scripts/rebase-bank-data-dates.cjs packages/demo-bff/personas/en/james_watson.json watson-today.json
```

The manual-test script and the demo BFF do this for you. A correctly re-based file reports a window of 90 days or more in `creditReport.metadata.creditInsights`.

## Webhooks: one needs a tunnel

Two independent webhook legs exist; only the first needs a public address.

| Leg                    | Who calls whom                                                                                             | Setup                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Algoan to engine       | Algoan calls `https://<public host>/v1/webhooks/algoan_credit/callback`                                    | A public tunnel to the engine, plus two subscriptions. See below. |
| Engine to your service | The engine posts `onboarding.state_changed` to `CLIENT_WEBHOOK_BASE_URL` plus the workflow's `notify` path | The environment variable; in Compose this is an internal address. |

For Algoan's leg, run the engine, open a tunnel to port 3000 and create the subscriptions against the tunnel's address. Locally:

| Terminal | Command                                                                                                                                                                                           | Why                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A        | `pnpm stack:up`                                                                                                                                                                                   | The engine and its dependencies.                                                   |
| B        | `cloudflared tunnel --url http://localhost:3000`                                                                                                                                                  | A public `https://<random>.trycloudflare.com` address. It changes on every start.  |
| C        | `node scripts/algoan-subscriptions.cjs create --target https://<random>.trycloudflare.com/v1/webhooks/algoan_credit/callback --events analysis_completed,analysis_failed --secret-from-connector` | One signed subscription per event; stale ones for the same path are deleted first. |
| C        | `node scripts/algoan-subscriptions.cjs list`                                                                                                                                                      | Expect exactly two `ACTIVE` rows with your target.                                 |

The script reads `ALGOAN_CLIENT_ID`, `ALGOAN_CLIENT_SECRET` and `ALGOAN_CALLBACK_SIGNING_SECRET` from the environment (`.env`), and `--secret-from-connector` means that last variable, which must equal the connector's `callbackSigningSecret`. Neither the script nor the engine prints a secret. Opening the callback URL in a browser answers 404 or 405; the route is POST-only. When you stop, remove the subscriptions:

```bash
$ node scripts/algoan-subscriptions.cjs delete --path /v1/webhooks/algoan_credit/callback
```

Subscribe to `analysis_completed` and `analysis_failed` only. The other events Algoan can send (`bank_details_fetched`, `report_*`) are acknowledged and ignored.

:::danger Never create the subscriptions in the Algoan console
The console's "Add a webhook" dialog asks for an event and a target and has no secret field. Algoan signs what it sends, so a console-created subscription is signed with a secret you cannot read, and every callback fails verification with `signature_mismatch`. Create subscriptions only with `scripts/algoan-subscriptions.cjs`, so the secret equals `callbackSigningSecret`.
:::

Algoan signs the JSON of the body's `payload` object alone, in an escaped form (non-ASCII as `\uXXXX`, then `/`, `<`, `%` and `@` as `\/`, `<`, `%` and `@`), as `X-Hub-Signature: sha256=<hex HMAC>`. The engine rebuilds that message from the parsed body; you do not need to.

To run the whole journey from a terminal, `TUNNEL=https://<random>.trycloudflare.com ./scripts/run-uk-bnpl-manual-test-algoan.sh --persona sherlock_holmes` stores the settings, recreates the subscriptions, starts an onboarding on `uk-bnpl-credit-check-algoan-local`, uploads the re-based persona and prints the outcome. It reads the persona files from `PERSONAS_DIR`, the same variable the demo BFF uses (the personae root, relative paths resolve against the repository root).

## Running the demo app

The demo (`packages/demo-bff` and `packages/demo-web`) runs on the host from the repository's `.env`, whose BNPL demo block names the engine (`ENGINE_BASE_URL`), the storage origin a browser can reach (`UPLOAD_PUBLIC_HOST`), the workflow (`BNPL_WORKFLOW_ID`) and the persona directory (`PERSONAS_DIR`, relative to the repository root). With the stack up and the connector settings stored:

```bash
$ pnpm demo:dev:tunnel
```

That replaces terminals B and C above: it opens the cloudflared tunnel to `ENGINE_BASE_URL`, recreates the two Algoan subscriptions for it, then starts the BFF on `DEMO_BFF_PORT` and the web app on `DEMO_WEB_ORIGIN`, and deletes the subscriptions again on Ctrl+C. Without the tunnel (`pnpm demo:dev`) only the BFF and the web app start, which is enough for a workflow whose credit step runs on `mock_credit`. The script refuses to start when the engine does not answer or does not know the workflow.

The customer's path through the web app, one page per step (the page follows the engine's current step, so a reload or a pasted link lands where the session is):

| Page                       | Step                                    | What the customer sees                                                                                                                                                                                                     |
| -------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                        |                                         | One "Start a credit check"; no scenario is chosen here.                                                                                                                                                                    |
| `/s/<token>/details`       | `applicant`                             | Name and email, typed by the customer.                                                                                                                                                                                     |
| `/s/<token>/consent`       | `credit_consent`                        | "Share your bank data": the Algoan privacy consent.                                                                                                                                                                        |
| `/s/<token>/bank`          | `bank_selection`                        | "Select your bank": search, the test bank "Algoan Demo Bank" and a grid of UK banks.                                                                                                                                       |
| `/s/<token>/bank/login`    | `bank_connection`                       | The bank's page: a profile (High, Medium or Low score: the three visible personae) that decides the outcome, and a required password that is never sent. "Connect bank" calls `POST /v1/bnpl/sessions/<token>/bank-login`. |
| `/s/<token>/bank/transfer` | `account_selection`                     | "Transmission in progress" for about two seconds, then the account list.                                                                                                                                                   |
| `/s/<token>/accounts`      | `account_selection`                     | "Select accounts for analysis": a row per account. A selection without the current account is refused with `CHECKING_ACCOUNT_REQUIRED`. A failed analysis lands here again, with the attempt notice.                       |
| `/s/<token>/bank/consent`  | `bank_access_consent`, `credit_check`   | The bank's authorisation page. "Authorise access" submits the consent and starts the check; "Refuse" ends the session with a link to `/`, because the engine cannot step back to `account_selection`.                      |
| `/s/<token>/processing`    | `credit_check`                          | Waits for the result.                                                                                                                                                                                                      |
| `/s/<token>/result`        | `approved`, `manual_review`, `declined` | The decision and the score tabs; the Accounts tab lists only the selected accounts.                                                                                                                                        |

The BFF records the bank login for the customer. Its calls, with the bodies a run returned:

```bash
$ curl -X POST localhost:3100/v1/bnpl/sessions -H 'Content-Type: application/json' -d '{}'
{"token":"YCoUFrREXEjoqLUKzGeKsg","persona":null}

$ curl -X POST localhost:3100/v1/bnpl/sessions/<token>/bank-login -H 'Content-Type: application/json' \
    -d '{"persona":"sherlock_holmes","method":"device"}'
{"phase":"collect","step":"account_selection","fields":[{"name":"selectedAccounts","type":"array","required":true,"value":null}],"data":{"bankId":"algoan_demo_bank","bankName":"Algoan Demo Bank","bankProfile":"high"},"persona":"sherlock_holmes","accounts":[{"id":"account-01","type":"CHECKING","name":"Current account","bankName":"Algoan Demo","owner":"SHERLOCK HOLMES","accountNumber":"6452","balance":3633.03,"currency":"GBP"},{"id":"account-02","type":"SAVINGS","name":"Savings account","bankName":"Algoan Demo","owner":"SHERLOCK HOLMES","accountNumber":"6453","balance":2150.4,"currency":"GBP"}]}

$ curl -X POST localhost:3100/v1/bnpl/sessions/<token>/submit -H 'Content-Type: application/json' \
    -d '{"values":{"selectedAccounts":["account-02"]}}'
{"code":"INVALID_STEP_DATA","message":"INVALID_STEP_DATA","errors":{"selectedAccounts":["CHECKING_ACCOUNT_REQUIRED"]}}
```

`bank-login` answers `409 SESSION_HAS_NO_BANK` when the engine is not on `bank_connection`, and `POST …/run` answers `409 ACCOUNTS_NOT_SELECTED` when `/state.data.selectedAccounts` is missing and `409 STEP_NOT_READY` when the onboarding is not on the credit step yet. `run` pushes only the selected accounts to Algoan.

## The KSA journey: Lean, then Algoan

`ksa-bnpl-lean-algoan` (its local fork `ksa-bnpl-lean-algoan-local`) replaces the simulated bank with a real one: the applicant links a Saudi sandbox bank in [Lean](https://www.leantech.me)'s widget, the engine's `lean_bank_data` connector reads the accounts, balances and six months of transactions, converts them to the bank-data document Algoan accepts (every amount in GBP at a fixed rate of 0.197 per riyal, the mid-market rate on 2026-10-19) and stores it on the onboarding; the credit step then scores that document, narrowed to the accounts the applicant selected. Lean's own salary verdict is shown on the result beside Algoan's and routes nothing.

| Step                  | Type                | What happens                                                                                                                                                                                   |
| --------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applicant`           | `contact-details`   | As the UK journey.                                                                                                                                                                             |
| `credit_consent`      | `consents`          | As the UK journey.                                                                                                                                                                             |
| `bank_connect`        | `connector-call`    | `{ leanCustomerId }` parks the step on Lean; Lean's `FINISHED` webhook resumes it with the income fields, the exported document (`bankDataDocument`) and the account summary (`bankAccounts`). |
| `bank_data_gate`      | `decision`          | `bankConnectOutcome = connected` goes on; anything else goes to `manual_review`. The demo BFF submits it.                                                                                      |
| `account_selection`   | `form`              | `selectedAccounts`, positions in the exported document (`account-01`, …).                                                                                                                      |
| `bank_access_consent` | `consents`          | As the UK journey.                                                                                                                                                                             |
| `credit_check`        | `credit-assessment` | `bankDataFrom: "bankDataDocument"`, `accountSelection: "selectedAccounts"`: the client submits `{}`, the engine narrows the stored document and starts Algoan.                                 |
| `manual_review`, …    |                     | As the UK journey.                                                                                                                                                                             |

### Before the first run

1. **Lean portal.** A sandbox application with at least one test user per mock bank (`LEA1_SAMAOB_SAU`, `LEA2_SAMAOB_SAU`). Store the app token, client secret and webhook secret as the engine's `lean_bank_data` connector settings (`clientId`, `clientSecret`, `callbackSigningSecret`), and set the portal's webhook URL once to `https://<NGROK_DOMAIN>/v1/webhooks/lean_bank_data/callback`.
2. **`.env`.** `BNPL_WORKFLOW_ID=ksa-bnpl-lean-algoan`, `BNPL_JOURNEY=ksa-lean-algoan`, the `LEAN_*` block and `NGROK_DOMAIN`; `.env.dist` has the commented block. `DEMO_WEB_PUBLIC_ORIGIN` and `VITE_BNPL_BFF_BASE_URL` stay as they are: the script sets both to the cloudflared URL for the run. There are no personae on this journey: keep the portal's test usernames to hand; no password is stored anywhere.
3. **ngrok and cloudflared.** An ngrok account with its free static domain and the agent installed (`ngrok config add-authtoken …`, or `NGROK_AUTHTOKEN` in the environment), and `cloudflared` installed (`brew install cloudflared`).

### Running it

```bash
$ pnpm stack:up            # the engine, with ksa-bnpl-lean-algoan published
$ pnpm demo:dev:tunnel     # ngrok on NGROK_DOMAIN to the engine, cloudflared to the web app, the Algoan subscriptions, the BFF and the web app
```

Two tunnels: the ngrok domain reaches the engine and admits only `/v1/webhooks/*` and `/v1/health/*` (Lean's and Algoan's callbacks; the Lean webhook URL never changes), and a cloudflared quick tunnel reaches the web app's dev server, which proxies `/v1/bnpl/*` and `/health` to the BFF so the page and its API share one origin. The script prints the cloudflared URL and hands it to the BFF as `DEMO_WEB_PUBLIC_ORIGIN` and to the web app as `VITE_BNPL_BFF_BASE_URL`. Open the demo on that URL, not on `localhost`: the mock bank redirects the applicant back to the origin the session started on, over HTTPS. A free ngrok account has one domain and a request quota, which is why the demo's own traffic does not go through it.

| Page                      | Step                                  | What the customer sees                                                                                                                                                         |
| ------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/s/<token>/details`      | `applicant`                           | Name and email.                                                                                                                                                                |
| `/s/<token>/consent`      | `credit_consent`                      | The credit-check consent.                                                                                                                                                      |
| `/s/<token>/bank/link`    | `bank_connect`                        | "Connect bank", which calls `POST /v1/bnpl/sessions/<token>/bank-link` and opens Lean's widget; the applicant picks a mock bank there and signs in with a portal test user (). |
| `/s/<token>/bank/waiting` | `bank_connect` (parked)               | "Waiting for your bank" while Lean reads the accounts (about twenty seconds in the sandbox). The bank's redirect lands here; `?lean_redirect=fail` offers the link again.      |
| `/s/<token>/accounts`     | `account_selection`                   | The exported accounts (current and savings, GBP balances); the current account is required.                                                                                    |
| `/s/<token>/bank/consent` | `bank_access_consent`, `credit_check` | "Authorise access" submits the consent and starts the assessment with an empty submit.                                                                                         |
| `/s/<token>/processing`   | `credit_check` (parked)               | Waits for Algoan.                                                                                                                                                              |
| `/s/<token>/result`       | terminal, `manual_review`             | Lean's income panel above Algoan's tabs, every figure in SAR (Algoan's GBP amounts converted back at the fixed rate), and "Start over".                                        |

"Start over" in the header of every page starts a fresh session and leaves the old onboarding where it is, for the admin panel to show. The outcome is whatever the test user's data produces: the portal's users all come from one sandbox generator (eight accounts, a monthly payroll pattern, random history depth; in the 2026-10-19 inventory five of seven showed a detectable salary and two a thin history), so "approved" and "review" are the outcomes to expect, and a "declined" only comes from Algoan's bands or an operator. `GET /v1/bnpl/personas` answers an empty list on this journey.

### The BFF's bank-link call

```bash
$ curl -X POST localhost:3100/v1/bnpl/sessions/<token>/bank-link -H 'Content-Type: application/json' \
    -d '{}'
{"appToken":"<app token>","customerId":"<uuid>","accessToken":"<customer token>","sandbox":true,"permissions":["identity","accounts","balance","transactions"],"accountType":"PERSONAL","successRedirectUrl":"https://<domain>/s/<token>/bank/waiting?lean_redirect=success","failRedirectUrl":"https://<domain>/s/<token>/bank/waiting?lean_redirect=fail"}
```

The BFF holds Lean's secret for this call alone; it answers `409 SESSION_HAS_NO_BANK` off the `bank_connect` step and `502 LEAN_UNAVAILABLE` when Lean refuses. A `400 INVALID_STEP_DATA` on `selectedAccounts` coded `NO_ACCOUNTS_SELECTED` from `run` means the selection named no account of the exported document; the web app points at "Start over".

## Limits

| Limit              | Value                                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction window | Algoan disregards transactions older than 90 days before the balance date. Re-base before pushing.                                                                                                                                                               |
| Account            | At least one `CHECKING` account, usage `PERSONAL`, in `GBP` (the provider's default currency; a typed step cannot override it), with `balance`, `balanceDate` and `bank.name`. Each transaction needs `currency`, `dates.debitedAt`, `description` and `amount`. |
| `bankData` size    | 1 MiB, `application/json`.                                                                                                                                                                                                                                       |
| Report             | 262 144 bytes of compact JSON. The engine drops the bulkiest parts first (top-level `transactions`, then the `transactions` inside `creditInsights`, then `cashFlows`) and, if it is still over, replaces it with `{ truncated: true, bytes }`.                  |
| Attempts           | `maxAttempts` (3). A failed analysis routes to `retry`; the last failure routes to `review`.                                                                                                                                                                     |
| Retention          | Algoan keeps each customer 90 days.                                                                                                                                                                                                                              |

## When a reply never comes

An onboarding parked on `credit_check` whose webhook never arrived (the tunnel died, the subscriptions point at an old hostname) is recovered by reconcile. The admin panel shows a **Reconcile** action on the onboarding; the API route is:

```bash
$ curl -X POST localhost:3000/v1/onboardings/<id>/pending-connector/reconcile \
    -H 'Content-Type: application/json' -d '{}'
```

The engine reads the analysis back from Algoan and finishes the step. The answer's `outcome` is `applied`, `still_pending` (Algoan is still computing) or `superseded`. Nothing is polled in the background: the webhook is the normal path and reconcile is the operator's fallback.

## Troubleshooting

- **Callbacks rejected with `signature_mismatch`** (audit event `webhook.inbound_callback_rejected`). The subscription was created in the console, or with a secret other than `callbackSigningSecret`. Delete it and recreate it with `algoan-subscriptions.cjs create … --secret-from-connector`.
- **No callback at all; the onboarding stays parked.** The tunnel restarted and the subscriptions still point at the old host, or the tunnel is down. Run `algoan-subscriptions.cjs list`, recreate for the new address, then reconcile the stuck onboarding.
- **`NO_CHECKING_ACCOUNT` in `creditReasonCodes`.** The file has no `CHECKING`, `PERSONAL` account in `GBP`. It is also the deliberate failure path: the step goes to `retry`.
- **`400 INVALID_STEP_DATA` on the `bankData` field with reason `INVALID_BANK_DATA`.** The document is not accepted as bank data (wrong content type, a missing `balance` or `balanceDate`, no matching account). Fix the file and upload again.
- **`ALREADY_EXISTS` in the engine's logs.** The same onboarding was pushed again, a retry. Expected: the customer is looked up by `customIdentifier` and reused.
- **A score far from the table.** Dates were not re-based, or the persona file was edited. Check the window in `creditReport.metadata.creditInsights`, and re-run.
- **`503 CREDIT_PROVIDER_CREDENTIALS_REJECTED` on the submit.** Algoan answered 401 or 403: wrong `clientId` or `clientSecret`, rotated sandbox credentials, or a product the project lacks. Re-enter them in the Connectors page; the engine log line names the connector and never a secret. The onboarding stays on the step.
- **`503 CREDIT_PROVIDER_REJECTED` on the submit.** Algoan refused the request for another reason; the payload carries its `providerStatus` and `providerCode`. A refused analysis (400 or 422) is instead the `bankData` field error above, with Algoan's code as the reason.
- **`503 ALGOAN_UNAVAILABLE`.** Algoan did not answer, timed out or failed. Retry later; `ALGOAN_TIMEOUT_MS` raises the timeout.
- **Callbacks rejected with `payload_invalid` or acknowledged with `callback_unresolved`** (audit event `webhook.inbound_callback_rejected`). The first is a verified body the adapter cannot read (answered `400 CALLBACK_PAYLOAD_INVALID`); the second a `customerId` Algoan answers 404 for, typically another project's event on the same subscription. Neither is redelivered; nothing is parked on them.
- **`409 PENDING_CONNECTOR_RECONCILE_UNSUPPORTED` with `reason: reference_malformed`.** The park records a reference that is not `customerId/analysisId`; the onboarding was parked by something other than this adapter. Review it by hand.
- **The engine refuses to boot after editing a workflow file.** A stored version differs from the file. Bump the version or fork under a new id rather than resetting the volume.

## Where to go next

- The [fixtures gallery](/fixtures) has both workflows with their step maps and the JSON, ready to copy into `workflows/users/`.
- The [API reference](/api) covers the document, state, submit and reconcile routes with their exact error codes.
