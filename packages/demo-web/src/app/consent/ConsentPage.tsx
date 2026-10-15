import { useState } from 'react';
import { useNavigate } from 'react-router';

import { submitSession } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

import { sessionPath } from '../session/session-routes';
import { SessionGate, useSessionView } from '../session/useSessionView';

const CONSENT_VERSION = '2026-10';

export function ConsentPage() {
  const state = useSessionView('consent');
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== 'ready') {
    return <SessionGate state={state} />;
  }

  const { token, view } = state;

  async function onContinue() {
    setSubmitting(true);
    setError(null);
    try {
      await submitSession(token, {
        openBankingCreditCheckVersion: CONSENT_VERSION,
        openBankingCreditCheckConsent: true,
      });
      void navigate(sessionPath(token, 'run'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not record your consent.');
      setSubmitting(false);
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Open banking consent</CardTitle>
        <CardDescription>
          We read your account data through open banking to assess your credit.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view.retry === true ? (
          <p role="status" className="rounded-md border border-warning bg-warning/15 p-3 text-sm">
            The credit check could not finish
            {view.attempt === undefined ? '' : ` (attempt ${view.attempt})`}. Confirm your consent
            to try again.
          </p>
        ) : null}
        <div className="flex items-start gap-3">
          <Checkbox
            id="consent"
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
          />
          <Label htmlFor="consent" className="leading-snug">
            I agree to the open-banking credit check, version {CONSENT_VERSION}.
          </Label>
        </div>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button disabled={!agreed || submitting} onClick={() => void onContinue()}>
          {submitting ? 'Saving…' : 'Continue'}
        </Button>
      </CardContent>
    </Card>
  );
}
