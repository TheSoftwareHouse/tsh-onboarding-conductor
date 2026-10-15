import { useState } from 'react';
import { useNavigate } from 'react-router';

import { runSession } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { sessionPath } from '../session/session-routes';
import { SessionGate, useSessionView } from '../session/useSessionView';

export function RunPage() {
  const state = useSessionView('run');
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== 'ready') {
    return <SessionGate state={state} />;
  }

  const { token } = state;

  async function onRun() {
    setRunning(true);
    setError(null);
    try {
      await runSession(token);
      void navigate(sessionPath(token, 'processing'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start the credit check.');
      setRunning(false);
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Ready to check your credit</CardTitle>
        <CardDescription>
          We will share this scenario&apos;s open-banking data with the credit provider and wait for
          its analysis.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button size="lg" disabled={running} onClick={() => void onRun()}>
          {running ? 'Starting…' : 'Run my credit check'}
        </Button>
      </CardContent>
    </Card>
  );
}
