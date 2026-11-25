import type { QueryClient } from '@tanstack/react-query';
import { authClient } from './auth-client';
import { isAuthEnabled } from './auth-config';

interface ScopedSession {
  user: { id: string; role?: string | null };
  session: { activeOrganizationId?: string | null };
}

/**
 * What every cached read is scoped to: the operator, their platform role and the organization
 * the session acts in. Null when no one is signed in. A change in any part makes the cache
 * another operator's, or another organization's, data.
 */
export function readSessionScope(session: ScopedSession | null | undefined): string | null {
  if (!session) {
    return null;
  }

  return [
    session.user.id,
    session.user.role ?? '',
    session.session.activeOrganizationId ?? '',
  ].join('|');
}

/**
 * The engine refused a request for want of a session. Reads not on screen were fetched with a
 * session the engine no longer accepts, so they go at once; the session is then re-read, and if
 * it is gone the sign-in gate takes over and the cache is cleared with it.
 */
export function handleUnauthorized(queryClient: QueryClient): void {
  if (!isAuthEnabled()) {
    return;
  }

  queryClient.removeQueries({ type: 'inactive' });
  authClient.$store.notify('$sessionSignal');
}
