const FAILURE_ACTION_SUFFIXES = [
  '_failed',
  '_rejected',
  '_not_found',
  '_missing',
  '_required',
  '_unavailable',
];

/** Whether an audit action reads as a failure; `connector.failure_*`, `auth.access_granted` and `auth.access_unauthenticated` do not. */
export function isFailureAuditAction(action: string): boolean {
  return (
    action === 'onboarding.rejected_attempt' ||
    FAILURE_ACTION_SUFFIXES.some((suffix) => action.endsWith(suffix))
  );
}
