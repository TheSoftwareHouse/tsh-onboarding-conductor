import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { getSession, waitForResult } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

import { pageFor, sessionPath } from '../session/session-routes';
import { SessionGate, toFailure, useToken, type SessionState } from '../session/useSessionView';

type Waiting = { status: 'waiting' } | { status: 'timeout' } | SessionState;

export function ProcessingPage() {
  const token = useToken();
  const navigate = useNavigate();
  const [state, setState] = useState<Waiting>({ status: 'waiting' });
  const [round, setRound] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function wait() {
      setState({ status: 'waiting' });
      const current = await getSession(token, { wait: 0, signal });

      if (pageFor(current) !== 'processing') {
        void navigate(sessionPath(token, pageFor(current)), { replace: true });
        return;
      }

      const outcome = await waitForResult(token, { signal });

      if (outcome.kind === 'result') {
        void navigate(sessionPath(token, 'result'), { replace: true });
      } else if (outcome.kind === 'retry') {
        void navigate(sessionPath(token, 'accounts'), { replace: true });
      } else {
        setState({ status: 'timeout' });
      }
    }

    wait().catch((error: unknown) => {
      if (!signal.aborted) {
        setState(toFailure(error));
      }
    });

    return () => controller.abort();
  }, [token, navigate, round]);

  if (state.status === 'not-found' || state.status === 'error') {
    return <SessionGate state={state} />;
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>
          {state.status === 'timeout'
            ? 'Still waiting for the provider'
            : 'Analysing your accounts'}
        </CardTitle>
        <CardDescription>
          {state.status === 'timeout'
            ? 'The credit provider has not answered yet. An operator can reconcile this session from the admin panel.'
            : 'This can take up to a minute. Keep this page open.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.status === 'timeout' ? (
          <Button onClick={() => setRound((value) => value + 1)}>Check again</Button>
        ) : (
          <Progress aria-label="Credit check in progress" className="animate-pulse" value={66} />
        )}
      </CardContent>
    </Card>
  );
}
