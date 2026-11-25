import type { ReactElement } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  type RouteObject,
} from 'react-router';
import { AcceptInvitationPage } from './accept-invitation/AcceptInvitationPage';
import { AuthGate } from './providers/AuthProvider/AuthGate/AuthGate';
import { AppProviders } from './providers/AppProviders';
import { AdminLayout } from './layout/AdminLayout';
import { ADMIN_ROUTES } from '@/constants/routes';
import { ADMIN_DETAIL_ROUTES, ADMIN_SECTIONS, DEFAULT_ADMIN_PATH } from './navigation';

// A data router, so a page can block navigation with `useBlocker`; nuqs's adapter reads the router, so it sits in the root route.
// The admin sections sit behind the sign-in gate; the invitation link does not, because the person opening it has no account yet.
const routes: RouteObject[] = [
  {
    element: (
      <NuqsAdapter>
        <Outlet />
      </NuqsAdapter>
    ),
    children: [
      { path: ADMIN_ROUTES.acceptInvitation.pattern, element: <AcceptInvitationPage /> },
      {
        element: (
          <AuthGate>
            <AdminLayout />
          </AuthGate>
        ),
        children: [
          ...ADMIN_SECTIONS.map((section) => ({
            path: section.path,
            element: <section.Component eyebrow={section.group} title={section.label} />,
          })),
          ...ADMIN_DETAIL_ROUTES.map((route) => ({ path: route.path, element: route.element })),
          { path: '*', element: <Navigate to={DEFAULT_ADMIN_PATH} replace /> },
        ],
      },
    ],
  },
];

const router = createBrowserRouter(routes);

/** Application root: app-wide providers and the router. */
export function App(): ReactElement {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
