import { useState } from 'react';
import { useNavigate } from 'react-router';

import { createSession } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';

import { readSessions, rememberSession } from './session-history';
import { FIRST_PAGE, sessionPath } from './session-routes';

/**
 * "Start over" (ADR 0052): a fresh session and its first page, on the same persona the old one
 * carried on the UK journey (the KSA journey has none). The old onboarding stays where it is (parked, in review or finished) for the
 * admin panel to show; nothing is cancelled.
 */
export function useStartOver(token: string | null) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startOver() {
    setStarting(true);
    setError(null);
    const persona = readSessions().find((entry) => entry.token === token)?.persona ?? null;

    try {
      const session = await createSession(persona ?? undefined);

      rememberSession(session.token, persona);
      void navigate(sessionPath(session.token, FIRST_PAGE));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start over.');
    } finally {
      setStarting(false);
    }
  }

  return { startOver, starting, error };
}

export function StartOverButton({
  token,
  variant = 'ghost',
  size = 'sm',
}: {
  token: string | null;
  variant?: 'ghost' | 'default' | 'outline';
  size?: 'sm' | 'default' | 'lg';
}) {
  const { startOver, starting, error } = useStartOver(token);

  return (
    <span className="flex items-center gap-2">
      {error === null ? null : (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <Button variant={variant} size={size} disabled={starting} onClick={() => void startOver()}>
        {starting ? 'Starting…' : 'Start over'}
      </Button>
    </span>
  );
}
