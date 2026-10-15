# Demo personae

Open Banking data pushed to Algoan by the BNPL demo (`POST /v2/customers/{customerId}/analyses`,
`format: ALGOAN`, `dataOrigin: OPEN_BANKING`). Each file is one `{ accounts: [...] }` document
with a `CHECKING` and a `SAVINGS` `PERSONAL` GBP account at "Algoan Demo" and their transactions
(the demo's account-selection step lets the user pick which of the two is analysed; the analysis
needs the `CHECKING` one).

Sandbox scores measured on 2026-10-15 (credit score version `1.0.0`, payment score `1.1.0`), the
second time with both accounts pushed: the savings account (monthly transfers from the current
account, a little interest) leaves every score unchanged, so the numbers below hold for both
accounts and for the checking account alone.
The score is deterministic for identical data and dates; it drifts slowly as the window moves.

| File                      | Accounts                              | Owner           | Credit score | Payment score | Band (default `bands`) | Profile                                                                                                                                                                                       |
| ------------------------- | ------------------------------------- | --------------- | ------------ | ------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `en/sherlock_holmes.json` | Current £3 633.03 + Savings £2 150.40 | SHERLOCK HOLMES | 965          | 10            | `approved` (≥ 700)     | Upstream sample. £2 500/month wage, mortgage, four consumer credits, two split payments, no incidents, stable cash flows.                                                                     |
| `en/james_watson.json`    | Current −£362.05 + Savings £40.00     | JAMES WATSON    | 598          | 3             | `review` (400–699)     | Upstream sample. £1 350/month wage, frequent gambling, overdraft fees, unpaid direct debits, two consumer loans. (The upstream README says "< 100"; today's sandbox model scores it 598.)     |
| `en/james_moriarty.json`  | Current −£3 784.19 + Savings £5.00    | JAMES MORIARTY  | 362          | 2             | `declined` (< 400)     | Authored here from Watson's file: no wage, Universal Credit only (£620/month), heavier gambling, debt-collection and bailiff payments, extra unpaid direct debit, deeper overdraft (−£3 784). |

Bands are the `credit-assessment` step's `bands` config (`approveFrom`, `reviewFrom`), so a workflow
can move the thresholds; the scores above are what the sandbox returns for these files.

## Re-basing dates

Algoan ignores transactions older than 90 days before `balanceDate`, so the files cannot be pushed
as they are. Before pushing, shift every date by `today − max(balanceDate)` over all accounts:
`balanceDate` and each `transactions[].dates.*`. The demo BFF does this at push time; the files
keep the upstream dates (balance date 2026-10-14, refreshed daily upstream by a cron).

## Provenance

`sherlock_holmes.json` and `james_watson.json` are copied verbatim from
[algoan/fake-open-banking-data](https://github.com/algoan/fake-open-banking-data) (`samples/en/`),
MIT licensed — see `LICENSE-algoan.txt`. `james_moriarty.json` was derived from `james_watson.json`
in this repository (see `specifications/bnpl-algoan/notes/algoan-sandbox-spike.md` for the
calibration attempts).

## Test-only persona

`en/fail_case.json` (owner `FAIL CASE`, one `CHECKING` GBP account, two transactions) is not a
demo scenario: the engine's `mock_credit` fixture reports a failed analysis
(`NO_CHECKING_ACCOUNT`) for that owner name, which drives the retry path in the demo web's
Playwright journey. The BFF lists it with `hidden: true`, so the start page shows no card for it;
the journey reaches it through `/start/fail_case`.
