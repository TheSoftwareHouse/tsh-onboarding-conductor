import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { BffError, runSession, submitSession } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { sessionPath } from '../session/session-routes';
import { StartOverButton } from '../session/StartOver';
import { SessionGate, useSessionView } from '../session/useSessionView';
import { selectionMessage } from './account-selection';

const BANK_ACCESS_VERSION = '2026-10';

const ACCESS_ITEMS = [
  'List of accounts and balances',
  'Transaction history',
  "Account holder's name",
  'IBAN',
] as const;

export function BankConsentPage() {
  const state = useSessionView('bank/consent');
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [refused, setRefused] = useState(false);
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== 'ready') {
    return <SessionGate state={state} />;
  }

  const { token, view } = state;
  const bankName =
    typeof view.data.bankName === 'string'
      ? view.data.bankName
      : (view.accounts?.[0]?.bankName ?? 'Your bank');

  async function onAuthorise() {
    setSubmitting(true);
    setError(null);
    try {
      // Recorded once: a failed run leaves the consent in place for the next attempt.
      if (view.step === 'bank_access_consent' && !consented) {
        await submitSession(token, {
          bankDataAccessVersion: BANK_ACCESS_VERSION,
          bankDataAccessConsent: true,
        });
        setConsented(true);
      }
      await runSession(token);
      void navigate(sessionPath(token, 'processing'));
    } catch (failure) {
      // The engine kept no account of the selection (`NO_ACCOUNTS_SELECTED`): the step holds and
      // the selection cannot be resubmitted from here, so the way on is to start over.
      const codes = failure instanceof BffError ? failure.errors?.selectedAccounts : undefined;

      setError(
        codes !== undefined
          ? `${selectionMessage(codes)} Start over to pick your accounts again.`
          : failure instanceof Error
            ? failure.message
            : 'Could not start the credit check.',
      );
      setSubmitting(false);
    }
  }

  if (refused) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Access refused</CardTitle>
          <CardDescription>
            Nothing was shared with Algoan. Start over to try again.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <StartOverButton token={token} variant="default" size="default" />
          <Button variant="outline" asChild>
            <Link to="/">Home</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <p className="text-2xl font-semibold tracking-tight text-primary">{bankName}</p>
        <CardTitle>Algoan wants to access:</CardTitle>
        <CardDescription>Review what you are about to share.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="list-disc pl-5 text-sm">
          {ACCESS_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="outline" disabled={submitting} onClick={() => setRefused(true)}>
            Refuse
          </Button>
          <Button className="flex-1" disabled={submitting} onClick={() => void onAuthorise()}>
            {submitting ? 'Authorising…' : 'Authorise access'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
