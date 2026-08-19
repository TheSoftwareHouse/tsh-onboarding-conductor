import type { ReactElement } from 'react';
import { AuthGate } from '@/features/auth';
import { AppProviders } from './providers';
import { AdminOnboardingsPage } from './pages/AdminOnboardingsPage';

/** Application root: gates the admin onboardings page behind sign-in and app-wide providers. */
export function App(): ReactElement {
  return (
    <AppProviders>
      <AuthGate>
        <AdminOnboardingsPage />
      </AuthGate>
    </AppProviders>
  );
}
