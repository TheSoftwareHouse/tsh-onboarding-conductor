import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { createSession } from '@/api/bnpl/bnpl.client';

import { rememberSession } from '../session/session-history';
import { sessionPath } from '../session/session-routes';

/** `/start/:persona`: creates the session and redirects, so "Start in a new tab" is a plain link. */
export function StartPage() {
  const { persona = '' } = useParams<{ persona: string }>();
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    createSession(persona)
      .then((session) => {
        rememberSession(session.token, persona);
        void navigate(sessionPath(session.token, 'details'), { replace: true });
      })
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : 'Could not start the session.');
      });
  }, [persona, navigate]);

  if (error !== null) {
    return (
      <div>
        <p role="alert" className="text-destructive">
          {error}
        </p>
        <Link className="mt-4 inline-block text-primary underline" to="/">
          Choose a scenario
        </Link>
      </div>
    );
  }

  return <p className="text-muted-foreground">Starting your session…</p>;
}
