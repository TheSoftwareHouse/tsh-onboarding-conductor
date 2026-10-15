import { Lock, ShieldCheck, UserCheck } from 'lucide-react';
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

const BADGES = [
  { icon: Lock, label: 'Secure connection' },
  { icon: ShieldCheck, label: 'GDPR compliant' },
  { icon: UserCheck, label: 'Your data stays private' },
] as const;

export function ConsentPage() {
  const state = useSessionView('consent');
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== 'ready') {
    return <SessionGate state={state} />;
  }

  const { token } = state;

  async function onContinue() {
    setSubmitting(true);
    setError(null);
    try {
      await submitSession(token, {
        openBankingCreditCheckVersion: CONSENT_VERSION,
        openBankingCreditCheckConsent: true,
      });
      void navigate(sessionPath(token, 'bank'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not record your consent.');
      setSubmitting(false);
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Share your bank data</CardTitle>
        <CardDescription>
          We read your account data through open banking to assess your credit.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="grid gap-3 sm:grid-cols-3">
          {BADGES.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="flex flex-col items-center gap-1 rounded-md border border-border p-3 text-center text-xs"
            >
              <Icon aria-hidden="true" className="size-5 text-primary" />
              {label}
            </li>
          ))}
        </ul>
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
          {submitting ? 'Saving…' : 'Go to bank selection'}
        </Button>
      </CardContent>
    </Card>
  );
}
