import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { getSession, MAX_WAIT_SECONDS } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

import { pageFor, sessionPath } from '../session/session-routes';
import { SessionGate, toFailure, useToken, type SessionState } from '../session/useSessionView';
import { StartOverButton } from '../session/StartOver';

/** The query Lean's redirect carries back (the BFF builds the URLs). */
export const LEAN_REDIRECT_QUERY = 'lean_redirect';
const LEAN_REDIRECT_FAIL = 'fail';

type Waiting = { status: 'waiting' } | SessionState;

/**
 * KSA journey: the bank link is parked on Lean, and Lean's webhook decides it. The page long-polls
 * the session until the engine leaves the park, then follows it. The bank's redirect lands here
 * too, with `?lean_redirect=success|fail`.
 */
export function BankWaitingPage() {
  const token = useToken();
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const failed = query.get(LEAN_REDIRECT_QUERY) === LEAN_REDIRECT_FAIL;
  const [state, setState] = useState<Waiting>({ status: 'waiting' });

  useEffect(() => {
    if (failed) {
      return undefined;
    }
    const controller = new AbortController();
    const { signal } = controller;

    async function follow() {
      for (;;) {
        const view = await getSession(token, { wait: MAX_WAIT_SECONDS, signal });
        const page = pageFor(view);

        if (page !== 'bank/waiting') {
          void navigate(sessionPath(token, page), { replace: true });
          return;
        }
      }
    }

    follow().catch((error: unknown) => {
      if (!signal.aborted) {
        setState(toFailure(error));
      }
    });

    return () => controller.abort();
  }, [token, navigate, failed]);

  if (state.status === 'not-found' || state.status === 'error') {
    return <SessionGate state={state} />;
  }

  if (failed) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>The bank did not connect</CardTitle>
          <CardDescription>
            Lean reported that the connection failed. Try the bank link again, or start over.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button asChild>
            <Link to={sessionPath(token, 'bank/link')}>Try again</Link>
          </Button>
          <StartOverButton token={token} variant="outline" size="default" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Waiting for your bank</CardTitle>
        <CardDescription>
          Lean is reading your accounts and the engine is waiting for its webhook. This takes about
          twenty seconds in the sandbox. Keep this page open.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Progress aria-label="Bank link in progress" className="animate-pulse" value={40} />
      </CardContent>
    </Card>
  );
}
