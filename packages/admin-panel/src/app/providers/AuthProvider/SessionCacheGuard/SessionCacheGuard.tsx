import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authClient } from '@/services/auth/auth-client';
import { readSessionScope } from '@/services/auth/session-cache';

/** Not yet known: the first session read has not finished. */
const UNKNOWN = Symbol('unknown');

/**
 * Keeps the React Query cache to the session it was fetched for. Signing out, a session that
 * expires or is revoked, or one broadcast as signed out by another tab clears the whole cache; a
 * different operator, a changed platform role or another active organization resets every query,
 * so no screen shows data the current session did not fetch.
 */
export function SessionCacheGuard(): null {
  const queryClient = useQueryClient();
  const { data: session, isPending } = authClient.useSession();
  const scope = readSessionScope(session);
  const previous = useRef<string | null | typeof UNKNOWN>(UNKNOWN);

  useEffect(() => {
    // Only a settled read counts: the first one sets the baseline, and a re-read (after every
    // sign-in, a 401 or a role change) is judged by what it settles on, never by a passing state.
    if (isPending) {
      return;
    }

    const before = previous.current;
    previous.current = scope;

    if (before === UNKNOWN || before === scope) {
      return;
    }

    if (scope === null) {
      queryClient.clear();
      return;
    }

    void queryClient.resetQueries();
    // better-auth refreshes its organization list only after an organization is created, updated
    // or deleted, so the switcher would otherwise keep the previous operator's organizations.
    authClient.$store.notify('$listOrg');
  }, [scope, isPending, queryClient]);

  return null;
}
