import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

import { sessionPath } from '../session/session-routes';
import { SessionGate, useSessionView } from '../session/useSessionView';

const TRANSFER_MS = 2000;
const TICK_MS = 100;
const FULL = 100;

/** Purely decorative: the bank connection was already recorded by the login. */
export function BankTransferPage() {
  const state = useSessionView('bank/transfer');
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);
  const ready = state.status === 'ready';
  const { token } = state;

  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;

      setProgress(Math.min(FULL, (elapsed / TRANSFER_MS) * FULL));
      if (elapsed >= TRANSFER_MS) {
        window.clearInterval(timer);
        void navigate(sessionPath(token, 'accounts'), { replace: true });
      }
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [ready, token, navigate]);

  if (state.status !== 'ready') {
    return <SessionGate state={state} />;
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Transmission in progress…</CardTitle>
        <CardDescription>Securely fetching your accounts from the bank.</CardDescription>
      </CardHeader>
      <CardContent>
        <Progress aria-label="Transmission in progress" value={progress} />
      </CardContent>
    </Card>
  );
}
