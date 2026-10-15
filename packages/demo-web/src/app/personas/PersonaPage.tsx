import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { createSession, listPersonas, type PersonaSummary } from '@/api/bnpl/bnpl.client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { readSessions, rememberSession } from '../session/session-history';
import { sessionPath } from '../session/session-routes';

const BAND_LABEL = { approved: 'Approved', review: 'Under review', declined: 'Declined' } as const;
const BAND_VARIANT = { approved: 'success', review: 'warning', declined: 'destructive' } as const;

export function startPath(persona: string): string {
  return `/start/${encodeURIComponent(persona)}`;
}

function GenericStart() {
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

function PersonaCard({ persona }: { persona: PersonaSummary }) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const session = await createSession(persona.id);

      rememberSession(session.token, persona.id);
      void navigate(sessionPath(session.token, 'details'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start the session.');
      setStarting(false);
    }
  }

  return (
    <Card data-testid={`persona-${persona.id}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>{persona.name}</CardTitle>
          <Badge variant={BAND_VARIANT[persona.expectedBand]}>
            Expected: {BAND_LABEL[persona.expectedBand]}
          </Badge>
        </div>
        <CardDescription>{persona.story}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Prefills your details and preselects the {persona.profile}-score profile at the bank.
        </p>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={() => void start()} disabled={starting}>
          {starting ? 'Starting…' : 'Start'}
        </Button>
        <Button variant="outline" asChild>
          <a href={startPath(persona.id)} target="_blank" rel="noopener noreferrer">
            Start in a new tab
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}

function SessionsFooter({ names }: { names: Map<string, string> }) {
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
              {entry.persona === null
                ? 'Credit check'
                : (names.get(entry.persona) ?? entry.persona)}
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

export function PersonaPage() {
  const personas = useQuery({
    queryKey: ['personas'],
    queryFn: ({ signal }) => listPersonas(signal),
  });
  const names = new Map((personas.data ?? []).map((persona) => [persona.id, persona.name]));

  return (
    <section>
      <h1 className="text-4xl font-light tracking-display text-card-foreground">
        Check your credit with open banking
      </h1>
      <p className="mt-4 max-w-xl text-muted-foreground">
        Walk through the bank journey and pick a profile at the bank&apos;s login, or take a
        shortcut: each scenario below prefills your details and preselects its profile.
      </p>
      <div className="mt-6">
        <GenericStart />
      </div>
      <h2 className="mt-10 text-lg font-medium text-card-foreground">Shortcuts</h2>
      {personas.isPending ? <p className="mt-8 text-muted-foreground">Loading scenarios…</p> : null}
      {personas.isError ? (
        <p role="alert" className="mt-8 text-destructive">
          Could not load the scenarios: {personas.error.message}
        </p>
      ) : null}
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {(personas.data ?? [])
          .filter((persona) => persona.hidden !== true)
          .map((persona) => (
            <PersonaCard key={persona.id} persona={persona} />
          ))}
      </div>
      <SessionsFooter names={names} />
    </section>
  );
}
