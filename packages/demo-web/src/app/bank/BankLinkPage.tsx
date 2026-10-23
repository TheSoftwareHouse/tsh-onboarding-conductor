import { useState } from 'react';
import { useNavigate } from 'react-router';

import { bankLink } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { connectLean } from '../lean/lean-widget';
import { sessionPath } from '../session/session-routes';
import { SessionGate, useSessionView } from '../session/useSessionView';

/**
 * KSA journey: the applicant links a bank in Lean's widget. Whichever mock-bank test user they
 * sign in as decides the data; nothing is chosen here. The widget is Lean's; the password goes to
 * the mock bank, never here.
 */
export function BankLinkPage() {
  const state = useSessionView('bank/link');
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== 'ready') {
    return <SessionGate state={state} />;
  }

  const { token } = state;

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const link = await bankLink(token);

      await connectLean(link, {
        callback: () => {
          // The widget closed, by redirect or by the user; the engine decides on Lean's webhook.
          void navigate(sessionPath(token, 'bank/waiting'));
        },
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not open the bank link.');
      setConnecting(false);
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Link your bank through Lean</CardTitle>
        <CardDescription>
          Connect in Lean&apos;s widget: pick a sandbox mock bank and sign in with a test user from
          the Lean portal. The accounts that user holds are what the credit check reads.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button disabled={connecting} onClick={() => void onConnect()}>
          {connecting ? 'Opening Lean…' : 'Connect bank'}
        </Button>
      </CardContent>
    </Card>
  );
}
