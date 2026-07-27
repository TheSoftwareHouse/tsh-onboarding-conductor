import type { ReactElement } from 'react';
import { AppProviders } from './providers';
import { AdminOnboardingsPage } from './pages/AdminOnboardingsPage';

/** Application root: wraps the admin onboardings page with app-wide providers. */
export function App(): ReactElement {
  return (
    <AppProviders>
      <AdminOnboardingsPage />
    </AppProviders>
  );
}
