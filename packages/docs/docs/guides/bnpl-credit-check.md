---
id: bnpl-credit-check
title: UK BNPL credit check
sidebar_label: UK BNPL credit check
description: Score a UK customer's open-banking data through the engine with Algoan - the API flow, the connector settings, the three demo personae, the webhook setup and what to check when it stalls.
---

→ The `uk-bnpl-credit-check-algoan` workflow takes a customer's bank data, has [Algoan](https://docs.algoan.com) score it and routes the onboarding on the result: approved, manual review or declined. The engine talks to Algoan; the client never does. This guide covers the client flow, the settings, the demo data, the one webhook that needs a public address, and the failures worth knowing.

The workflow ships as [`uk-bnpl-credit-check-algoan`](/fixtures/uk-bnpl-credit-check-algoan). Its twin [`credit-check`](/fixtures/credit-check) runs the same shape on the `mock_credit` provider, with no network and no credentials, which is what the end-to-end suite uses.

## The steps

| Step                   | Type                | What happens                                                                    |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------- |
| `applicant`            | `contact-details`   | First name, last name, email. Collected for the operator; not sent to Algoan.   |
| `credit_consent`       | `consents`          | The open-banking credit-check consent (`openBankingCreditCheckConsent`).        |
| `credit_check`         | `credit-assessment` | Takes one `bankData` document, starts the analysis, parks until Algoan answers. |
| `manual_review`        | `manual-review`     | Where a mid score waits for an operator.                                        |
| `approved`, `declined` | `terminal`          | The two ways it ends.                                                           |

The `credit_check` step has four ports: `approved`, `review` (to `manual_review`), `declined` and `retry` (back to `credit_consent`). Scores are banded by the step's `bands` config, `approveFrom: 700` and `reviewFrom: 400`: at or above 700 is approved, 400 to 699 is review, below 400 is declined. A failed analysis is `retry` until `maxAttempts` (3) is reached, then `review`. The workflow also sets `webhook.notify.path: notify`, so the engine posts `onboarding.state_changed` to your service whenever the onboarding moves.

## The client flow

The first two steps are ordinary submits, as in [Your first onboarding](./your-first-onboarding.md). The third differs: the step owns one input, `bankData`, a `file` field that accepts `application/json` up to 1 MiB. Bank data never goes in a submit body. It travels as an uploaded document, so the client reserves it, uploads it straight to object storage, completes it, then submits the step with the document id.

1. `POST /v1/onboardings` with `{"workflowId":"uk-bnpl-credit-check-algoan"}`.
2. Submit `applicant`, then `credit_consent` (`{"openBankingCreditCheckConsent": true}`).
3. `POST /v1/onboardings/{id}/documents` with `{"field":"bankData","contentType":"application/json","sizeBytes":<n>}`. The response carries `documentId` and a presigned `upload` form (`upload.url`, `upload.fields`).
4. Send the file to `upload.url` as a multipart form with `upload.fields` first and the file last. Storage answers `204`.
5. `POST /v1/onboardings/{id}/documents/{documentId}/complete` with `{}`. The engine reads the object back and checks its size and content type.
6. `POST /v1/onboardings/{id}/submit` with `{"bankData":"<documentId>"}`.

The submit returns while Algoan is still computing; the onboarding is parked on `credit_check`. Read `GET /v1/onboardings/{id}/state` to follow it:

- `pending` is `{ connectorId, parkedAt }` while the provider works and `null` afterwards. Render "processing" from it.
- `data` holds the values the credit step exposes to the client: `creditOutcome`, `creditScore`, `creditScoreBand`, `creditIndicators`, `creditSecondaryScores` and `creditReport`.
- `currentStep` moves to `approved`, `declined`, `manual_review` or, on a failed analysis, back to `credit_consent`.

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

## The three demo personae

The repository ships three bank-data files for the Algoan sandbox, in `packages/demo-bff/personas/en/`. Each is one `{ accounts: [...] }` document with a single `CHECKING` `PERSONAL` GBP account. Scores measured against the sandbox on 2026-10-15 (credit score version `1.0.0`, payment score `1.1.0`); the same data pushed twice returns the same score.

| File                   | Credit score | Payment score | Band                      | Outcome         |
| ---------------------- | ------------ | ------------- | ------------------------- | --------------- |
| `sherlock_holmes.json` | 965          | 10            | `approve` (700 and above) | `approved`      |
| `james_watson.json`    | 598          | 3             | `review` (400 to 699)     | `manual_review` |
| `james_moriarty.json`  | 362          | 2             | `decline` (below 400)     | `declined`      |

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

To run the whole journey from a terminal, `TUNNEL=https://<random>.trycloudflare.com ./scripts/run-uk-bnpl-manual-test-algoan.sh --persona sherlock_holmes` stores the settings, recreates the subscriptions, starts an onboarding on `uk-bnpl-credit-check-algoan-local`, uploads the re-based persona and prints the outcome.

## Running the demo app

The demo (`packages/demo-bff` and `packages/demo-web`) runs on the host from the repository's `.env`, whose BNPL demo block names the engine (`ENGINE_BASE_URL`), the storage origin a browser can reach (`UPLOAD_PUBLIC_HOST`), the workflow (`BNPL_WORKFLOW_ID`) and the persona directory (`PERSONAS_DIR`, relative to the repository root). With the stack up and the connector settings stored:

```bash
$ pnpm demo:dev --tunnel
```

That replaces terminals B and C above: it opens the cloudflared tunnel to `ENGINE_BASE_URL`, recreates the two Algoan subscriptions for it, then starts the BFF on `DEMO_BFF_PORT` and the web app on `DEMO_WEB_ORIGIN`, and deletes the subscriptions again on Ctrl+C. Without `--tunnel` only the BFF and the web app start, which is enough for a workflow whose credit step runs on `mock_credit`. The script refuses to start when the engine does not answer or does not know the workflow.

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
- **`401` from Algoan.** Wrong `clientId` or `clientSecret`, or the sandbox credentials were rotated. Re-enter them in the Connectors page.
- **`503 ALGOAN_UNAVAILABLE`.** Algoan did not answer, timed out or failed. Retry later; `ALGOAN_TIMEOUT_MS` raises the timeout.
- **The engine refuses to boot after editing a workflow file.** A stored version differs from the file. Bump the version or fork under a new id rather than resetting the volume.

## Where to go next

- The [fixtures gallery](/fixtures) has both workflows with their step maps and the JSON, ready to copy into `workflows/users/`.
- The [API reference](/api) covers the document, state, submit and reconcile routes with their exact error codes.
