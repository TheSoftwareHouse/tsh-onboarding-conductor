# Countries and risk scores

All time, all workflows (assumed). Source: `onboarding_stats` grouped by `country`.

| Country | Onboardings | Risk min / median / max |
| ------- | ----------- | ----------------------- |
| FR      | 7           | 0 / 0 / 30              |
| ES      | 5           | 0 / 0 / 50              |
| GB      | 5           | 0 / 0 / 30              |
| SE      | 5           | 0 / 0 / 20              |
| IE      | 4           | 0 / 0 / 0               |
| PL      | 4           | 0 / 0 / 0               |
| IT      | 3           | 0 / 0 / 0               |
| NL      | 3           | 0 / 0 / 20              |
| TR      | 3           | 70 / 70 / 90            |
| AE      | 2           | 40 / 50 / 60            |
| DE      | 2           | 0 / 0 / 0               |
| (none)  | 3           | 0 / 0 / 0               |

Findings

1. France is the largest group with 7 onboardings.
2. Risk runs highest for TR (3 onboardings, median 70, max 90) and AE (2 onboardings, median 50,
   max 60); every other country has a median of 0.
3. These are tiny groups: three and two onboardings. They are worth a look, not a rate, and say
   nothing about how future applicants from those countries will score.

The split per applicant email address cannot be produced. `onboarding_stats` refuses to group by
email because it is personal data, by design, and the same goes for names and dates of birth. I have
not rebuilt it from individual onboardings. A field that passes in clear (country, source of
funds, status, current step) can be grouped instead, for example source of funds.
