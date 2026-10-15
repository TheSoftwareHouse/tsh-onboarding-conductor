import { QRCodeSVG } from 'qrcode.react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { sessionPath } from '../session/session-routes';
import { SessionGate, useSessionView } from '../session/useSessionView';
import type { BankLoginMethod } from '@/api/bnpl/bnpl.client';

/** Where each way of authenticating leads: the bank's login page, told how the user arrived. */
export function loginPath(token: string, method: BankLoginMethod): string {
  return `${sessionPath(token, 'bank/login')}?method=${method}`;
}

export function BankAuthPage() {
  const state = useSessionView('bank/auth');

  if (state.status !== 'ready') {
    return <SessionGate state={state} />;
  }

  const { token, view } = state;
  const bankName = typeof view.data.bankName === 'string' ? view.data.bankName : 'your bank';
  const continueUrl = `${window.location.origin}${loginPath(token, 'qr')}`;

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Authenticate with the {bankName} app</CardTitle>
        <CardDescription>
          Scan the code with your phone to continue in the bank&apos;s app, or carry on here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <div className="rounded-md border border-border bg-white p-4">
          <QRCodeSVG value={continueUrl} size={180} title={`Sign in to ${bankName}`} />
        </div>
        <Button className="w-full" asChild>
          <Link to={loginPath(token, 'device')}>Continue on this device</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
