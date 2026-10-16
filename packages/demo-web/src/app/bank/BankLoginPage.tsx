import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { bankLogin, listPersonas, type PersonaSummary } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { sessionPath } from '../session/session-routes';
import { SessionGate, useSessionView } from '../session/useSessionView';

const PROFILE_ORDER = ['high', 'medium', 'low', 'test'] as const;
const PROFILE_TITLE = {
  high: 'High score',
  medium: 'Medium score',
  low: 'Low score',
  test: 'Test profile',
} as const;
const PROFILE_DOT = {
  high: 'bg-success',
  medium: 'bg-warning',
  low: 'bg-destructive',
  test: 'bg-muted-foreground',
} as const;

/**
 * The profiles the bank offers: the visible personae, one card each, best score first. The
 * hidden test persona appears only for a session that already carries it.
 */
export function profileCards(
  personas: readonly PersonaSummary[],
  sessionPersona: string | null,
): PersonaSummary[] {
  return personas
    .filter((persona) => persona.hidden !== true || persona.id === sessionPersona)
    .sort((a, b) => PROFILE_ORDER.indexOf(a.profile) - PROFILE_ORDER.indexOf(b.profile));
}

/** The simulated bank wants a password, any password; it never leaves the browser. */
export function isPasswordAccepted(password: string): boolean {
  return password.trim() !== '';
}

export function BankLoginPage() {
  const state = useSessionView('bank/login');
  const navigate = useNavigate();
  const personas = useQuery({
    queryKey: ['personas'],
    queryFn: ({ signal }) => listPersonas(signal),
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== 'ready') {
    return <SessionGate state={state} />;
  }

  const { token, view } = state;
  const bankName = typeof view.data.bankName === 'string' ? view.data.bankName : 'Your bank';
  const cards = profileCards(personas.data ?? [], view.persona);
  const selected = chosen ?? view.persona;
  const ready = selected !== null && isPasswordAccepted(password);

  async function onConnect() {
    if (selected === null || !isPasswordAccepted(password)) {
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      await bankLogin(token, { persona: selected, method: 'device' });
      void navigate(sessionPath(token, 'bank/transfer'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not connect to the bank.');
      setConnecting(false);
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <p className="text-2xl font-semibold tracking-tight text-primary">{bankName}</p>
        <CardTitle>Sign in to connect your accounts</CardTitle>
        <CardDescription>
          This bank is simulated: the profile you sign in with decides the outcome.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {personas.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load the profiles: {personas.error.message}
          </p>
        ) : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-card-foreground">Profile</legend>
          {cards.map((persona) => (
            <label
              key={persona.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-secondary',
              )}
            >
              <input
                type="radio"
                name="profile"
                className="mt-1.5"
                value={persona.id}
                checked={selected === persona.id}
                onChange={() => setChosen(persona.id)}
              />
              <span
                aria-hidden="true"
                className={cn('mt-1.5 size-3 shrink-0 rounded-full', PROFILE_DOT[persona.profile])}
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium">{PROFILE_TITLE[persona.profile]}</span>
                <span className="text-xs text-muted-foreground">{persona.profileLabel}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bank-password">Password</Label>
          <Input
            id="bank-password"
            type="password"
            autoComplete="off"
            required
            placeholder="Any value works"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Required, never sent anywhere.</p>
        </div>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button disabled={!ready || connecting} onClick={() => void onConnect()}>
          {connecting ? 'Connecting…' : 'Connect bank'}
        </Button>
      </CardContent>
    </Card>
  );
}
