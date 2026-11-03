# Provider health

All time, all connectors. Source: `connector_health`.

| Connector             | Failures (retried, fellBack, ignored, propagated, unavailable) | Rejected | Invalid | Callbacks applied | Parked now |
| --------------------- | -------------------------------------------------------------- | -------- | ------- | ----------------- | ---------- |
| mock_async_callback_2 | 0                                                              | 0        | 0       | 23                | 4          |
| smtp_email_otp        | 0                                                              | 2        | 8       | 0                 | 0          |

Findings

1. No provider is failing: neither connector shows a retried, fellBack, ignored, propagated or
   unavailable count.
2. 4 onboardings are parked on `mock_async_callback_2`: they are waiting for a provider callback,
   which is different from a failure. 23 callbacks from this provider have been applied.
3. `smtp_email_otp` has 2 rejected and 8 invalid and nothing parked. These are the connector
   refusing applicants or finding a submitted code wrong, not an outage; the tool does not say
   why, so a cause is for the analyst to confirm.

Caveats: `parked` is the current number whatever the window; `truncated` is empty, so the counts
are complete for the window read.
