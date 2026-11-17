import type { ReactElement } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AcceptInvitationPage } from './accept-invitation/AcceptInvitationPage';
import { AuthGate } from './providers/AuthProvider/AuthGate/AuthGate';
import { AppProviders } from './providers/AppProviders';
import { AdminLayout } from './layout/AdminLayout';
import { ADMIN_ROUTES } from '@/constants/routes';
import { ADMIN_DETAIL_ROUTES, ADMIN_SECTIONS, DEFAULT_ADMIN_PATH } from './navigation';

/**
 * Application root: app-wide providers and the router. The admin sections sit behind the sign-in
 * gate; the invitation link does not, because the person opening it has no account yet.
 */
export function App(): ReactElement {
  return (
    <AppProviders>
      <BrowserRouter>
        <NuqsAdapter>
          <Routes>
            <Route
              path={ADMIN_ROUTES.acceptInvitation.pattern}
              element={<AcceptInvitationPage />}
            />
            <Route
              element={
                <AuthGate>
                  <AdminLayout />
                </AuthGate>
              }
            >
              {ADMIN_SECTIONS.map((section) => (
                <Route
                  key={section.path}
                  path={section.path}
                  element={<section.Component eyebrow={section.group} title={section.label} />}
                />
              ))}
              {ADMIN_DETAIL_ROUTES.map((route) => (
                <Route key={route.path} path={route.path} element={route.element} />
              ))}
              <Route path="*" element={<Navigate to={DEFAULT_ADMIN_PATH} replace />} />
            </Route>
          </Routes>
        </NuqsAdapter>
      </BrowserRouter>
    </AppProviders>
  );
}
