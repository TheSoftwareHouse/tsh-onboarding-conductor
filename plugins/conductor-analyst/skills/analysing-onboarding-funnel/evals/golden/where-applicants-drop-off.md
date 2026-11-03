# Where applicants drop off in analyst-investigation

All time, workflow `analyst-investigation`. Source: `onboarding_funnel`, cross-checked with
`connector_health` for the parked count.

| Step                     | Reached | Moved on | Ended there                       | Still waiting |
| ------------------------ | ------- | -------- | --------------------------------- | ------------- |
| collect_profile          | 46      | 39       | 4 rejected                        | 3             |
| send_email_code          | 39      | 35       | -                                 | 4             |
| verify_email_code        | 35      | 31       | 2 rejected                        | 2             |
| upload_identity_document | 31      | 29       | -                                 | 2             |
| check_identity           | 29      | 10       | 9 approved, 4 rejected            | 6             |
| review_identity          | 10      | -        | 2 approved, 2 rejected, 2 invalid | 4             |

Findings

1. `check_identity` has the most onboardings still waiting: 6 of the 29 that reached it. But
   `connector_health` shows 4 onboardings parked on `mock_async_callback_2`, so 4 of those 6 are
   waiting for the provider's callback and have not left. Only 2 stopped on their own.
2. The earlier steps each lose a few applicants who never submitted: 3 at collect_profile, 4 at
   send_email_code, 2 at verify_email_code and 2 at upload_identity_document, 11 in total.
3. The 4 rejections at collect_profile and the 2 at verify_email_code are outcomes of those steps
   (a score threshold; too many wrong codes), not applicants dropping off.
4. The 4 waiting at review_identity are waiting for a reviewer.

Caveats: "waiting" is judged at the end of the window and includes parked onboardings. Counts are of
onboardings with activity in the window. Median time in each step is a second or less, so there is
no step worth ranking as slow. These are small counts and say nothing about future volumes.
