import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { createSession } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';

import { readSessions, rememberSession } from '../session/session-history';
import { sessionPath } from '../session/session-routes';

function StartButton() {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const session = await createSession();

      rememberSession(session.token, null);
      void navigate(sessionPath(session.token, 'details'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start the session.');
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="lg" onClick={() => void start()} disabled={starting}>
          {starting ? 'Starting…' : 'Start a credit check'}
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function SessionsFooter() {
  const [sessions] = useState(readSessions);

  if (sessions.length === 0) {
    return null;
  }

  return (
    <footer className="mt-12 border-t border-border pt-6">
      <h2 className="text-sm font-medium text-card-foreground">Sessions started in this browser</h2>
      <ul className="mt-3 flex flex-col gap-1 text-sm">
        {sessions.map((entry) => (
          <li key={entry.token}>
            <Link
              className="text-primary underline-offset-4 hover:underline"
              to={sessionPath(entry.token, 'details')}
            >
              Credit check
            </Link>{' '}
            <span className="text-muted-foreground">
              · {new Date(entry.startedAt).toLocaleTimeString()}
            </span>
          </li>
        ))}
      </ul>
    </footer>
  );
}

/**
 * `/`: one way in. The scenario is chosen later, at the simulated bank's login, so nothing here
 * knows the personae.
 */
export function HomePage() {
  return (
    <section>
      <h1 className="text-4xl font-light tracking-display text-card-foreground">
        Check your credit with open banking
      </h1>
      <p className="mt-4 max-w-xl text-muted-foreground">
        Enter your details, connect your bank and let Algoan analyse your accounts. The bank is
        simulated: the profile you sign in with decides the outcome.
      </p>
      <div className="mt-6">
        <StartButton />
      </div>
      <SessionsFooter />
    </section>
  );
}
