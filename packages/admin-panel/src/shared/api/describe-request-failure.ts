import { HttpStatusCode } from 'axios';

/**
 * Turns a failed admin request into something an operator can act on. The three
 * authentication-related statuses each call for a different response — sign in again, ask for a
 * role, or wait — and a bare status code tells the operator none of that.
 *
 * `resourceLabel` names the data that was refused, so the role message points at the section the
 * operator actually tried to open (for example `onboardings` or `the audit log`).
 */
export function describeRequestFailure(
  status: number | undefined,
  cause: unknown,
  resourceLabel: string,
): string {
  switch (status) {
    case HttpStatusCode.Unauthorized:
      return 'Your session is no longer accepted by the engine. Sign in again.';
    case HttpStatusCode.Forbidden:
      return `Your account is signed in but is not assigned a role that may view ${resourceLabel}.`;
    case HttpStatusCode.ServiceUnavailable:
      // The engine could not reach Entra to check the token. Nothing is wrong with the session,
      // so signing in again would not help and the operator should simply retry.
      return 'The engine cannot verify sign-ins right now. This is not a problem with your account — try again shortly.';
    case undefined:
      return cause instanceof Error ? cause.message : 'Request failed.';
    default:
      return `Request failed with status ${status}.`;
  }
}
