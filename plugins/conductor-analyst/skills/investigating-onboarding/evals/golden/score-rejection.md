# Why {{manifest:score-reject-01}} was rejected

**Rejected by the risk score at `collect_profile`.** When the applicant submitted the profile step,
the timeline shows one move, from `collect_profile` straight to `rejected`, with the risk score going
from 0 to 70. No connector was called and no reviewer was involved.

The workflow version the onboarding ran (`analyst-investigation`, version 1) scores `risk` at that
step with three rules: country in RU, IR, TR or AE adds 40; a politically exposed person declaration
adds 30; source of funds `sale_of_asset` or `other` adds 20. Its transition out of the step sends the
onboarding to `rejected` when `risk` is 60 or more. Here two rules fired:

- country TR: +40
- politically exposed person declared: +30

Total 70, which is at least 60, so the onboarding was rejected. The source of funds was not one of the
scored values, so that rule added nothing.

No rejection reason code is recorded, and that is expected: a reason code comes from a connector that
refuses an applicant, and none was involved. The applicant cannot continue this onboarding; it is
final.

Masked: the applicant's name, address and other free-text answers are withheld; email and phone
appear only as pseudonyms and the date of birth as an age band. None of that was needed to explain
the decision. Whether these rules and the threshold are right is a question for the risk owners, not
something this investigation decides.
