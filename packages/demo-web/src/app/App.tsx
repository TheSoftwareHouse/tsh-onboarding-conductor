import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Outlet, useMatch } from 'react-router';

import { AppRoutes } from './routes';
import { StartOverButton } from './session/StartOver';

/** TSH wordmark: the brand lockup is plain text here, set in the display tracking. */
function Brand() {
  return (
    <span className="text-xl font-medium tracking-brand text-card-foreground">
      TSH <span className="font-light text-muted-foreground">BNPL credit check</span>
    </span>
  );
}

/** The shell every journey page renders inside; the journey pages mount in `<Outlet />`. */
export function Layout() {
  // On a session page the header offers "Start over" (ADR 0052): a fresh session, first page.
  const session = useMatch('/s/:token/*');
  const token = session?.params.token ?? null;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Brand />
          <span className="flex items-center gap-3 text-sm text-muted-foreground">
            {token === null ? null : <StartOverButton token={token} />}
            <span>Demo</span>
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes layout={<Layout />} />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
