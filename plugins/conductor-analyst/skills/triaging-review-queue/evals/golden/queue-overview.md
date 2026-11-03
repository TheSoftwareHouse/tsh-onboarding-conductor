# What is waiting right now

Assumes a fresh `pnpm stack:reset` plus `pnpm onboardings:seed -- --spread-days 90` (seed 42). The parked items' place among the review items depends on that spread.

`review_queue` returns 8 onboardings in the queue (not truncated): 4 are awaiting manual review and 4
are parked on a provider.

**Awaiting manual review (4)** — all of workflow `analyst-investigation` at step `review_identity`, status
`awaiting_manual_review`, each reached after the provider's callback came back with a verdict of
`review`:

| Onboarding                     | Risk score | Age order                 |
| ------------------------------ | ---------- | ------------------------- |
| {{manifest:review-waiting-01}} | 0          | oldest in the whole queue |
| {{manifest:review-waiting-02}} | 0          | second                    |
| {{manifest:review-waiting-03}} | 30         | third                     |
| {{manifest:review-waiting-04}} | 20         | youngest in the queue     |

**Parked (4)** — status `awaiting_user` at `check_identity`, waiting for a callback from
`mock_async_callback_2`; `parkedAt` is set on each. With a 90-day spread they sit between the third and fourth review items
in age. The oldest parked one is {{manifest:parked-awaiting-02}}; the others are
{{manifest:parked-awaiting-03}}, {{manifest:parked-awaiting-01}} and {{manifest:parked-awaiting-04}}, with
risk scores of 30, 0 and 20 respectively. Ages are in days from the tool, not seconds; a parked
onboarding's age counts from when it parked and a review item's from when it was created, so the two
are only roughly comparable.

**Where to start.** The two groups need different work. Reviews need a person: take
{{manifest:review-waiting-01}} and {{manifest:review-waiting-02}} first because they are the oldest, then
consider {{manifest:review-waiting-03}} (the PEP-declared case, risk 30) before the younger
{{manifest:review-waiting-04}}, since a higher score is a cited reason to look earlier. Parked items need
chasing or a reconcile with the provider, not a human judgement; I can offer that for any of them and
would show a preview first.

I have not looked at any decision for these: what to do with a review item is the reviewer's call in the
admin panel, and nothing here records it.
