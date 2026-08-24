import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthGate } from '@/features/auth';
import { AppProviders } from './providers';
import { AdminLayout } from './AdminLayout';
import { ADMIN_DETAIL_ROUTES, ADMIN_SECTIONS, DEFAULT_ADMIN_PATH } from './navigation';

/** Application root: gates the admin sections behind sign-in, app-wide providers, and the router. */
export function App(): ReactElement {
  return (
    <AppProviders>
      <AuthGate>
        <BrowserRouter>
          <Routes>
            <Route element={<AdminLayout />}>
              {ADMIN_SECTIONS.map((section) => (
                <Route key={section.path} path={section.path} element={section.element} />
              ))}
              {ADMIN_DETAIL_ROUTES.map((route) => (
                <Route key={route.path} path={route.path} element={route.element} />
              ))}
            </Route>
            <Route path="*" element={<Navigate to={DEFAULT_ADMIN_PATH} replace />} />
          </Routes>
        </BrowserRouter>
      </AuthGate>
    </AppProviders>
  );
}
