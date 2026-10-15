import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { BffError, getSession, type SessionView } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { pageFor, sessionPath, type JourneyPage } from './session-routes';

export type SessionState =
  | { status: 'loading' }
  | { status: 'ready'; view: SessionView }
  | { status: 'not-found' }
  | { status: 'error'; message: string };

export function useToken(): string {
  const { token } = useParams<{ token: string }>();

  return token ?? '';
}

/**
 * Loads the session with `wait: 0` and sends the browser to the page its phase and step belong
 * on; resolves to `ready` only when `page` is that page.
 */
export function useSessionView(page: JourneyPage): SessionState & { token: string } {
  const token = useToken();
  const navigate = useNavigate();
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    getSession(token, { wait: 0, signal: controller.signal })
      .then((view) => {
        const target = pageFor(view);

        if (target === page) {
          setState({ status: 'ready', view });
        } else {
          void navigate(sessionPath(token, target), { replace: true });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState(toFailure(error));
      });

    return () => controller.abort();
  }, [token, page, navigate]);

  return { ...state, token };
}

export function toFailure(error: unknown): SessionState {
  if (error instanceof BffError && error.status === 404) {
    return { status: 'not-found' };
  }

  return {
    status: 'error',
    message: error instanceof Error ? error.message : 'Something went wrong.',
  };
}

export function SessionNotFound() {
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Session not found</CardTitle>
        <CardDescription>
          This session does not exist or the demo service was restarted. Start a new one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/">Choose a scenario</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** What a page renders while its session is not ready; `null` once it is. */
export function SessionGate({ state }: { state: SessionState }): ReactNode {
  if (state.status === 'loading') {
    return <p className="text-muted-foreground">Loading your session…</p>;
  }
  if (state.status === 'not-found') {
    return <SessionNotFound />;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-destructive">
        {state.message}
      </p>
    );
  }

  return null;
}
