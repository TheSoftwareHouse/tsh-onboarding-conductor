import type { ReactElement } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  type RouteObject,
} from 'react-router';
import { AuthGate } from './providers/AuthProvider/AuthGate/AuthGate';
import { AppProviders } from './providers/AppProviders';
import { AdminLayout } from './layout/AdminLayout';
import { ADMIN_DETAIL_ROUTES, ADMIN_SECTIONS, DEFAULT_ADMIN_PATH } from './navigation';

// A data router, so a page can block navigation with `useBlocker`; nuqs's adapter reads the router, so it sits in the root route.
const routes: RouteObject[] = [
  {
    element: (
      <NuqsAdapter>
        <Outlet />
      </NuqsAdapter>
    ),
    children: [
      {
        element: <AdminLayout />,
        children: [
          ...ADMIN_SECTIONS.map((section) => ({
            path: section.path,
            element: <section.Component eyebrow={section.group} title={section.label} />,
          })),
          ...ADMIN_DETAIL_ROUTES.map((route) => ({ path: route.path, element: route.element })),
        ],
      },
      { path: '*', element: <Navigate to={DEFAULT_ADMIN_PATH} replace /> },
    ],
  },
];

const router = createBrowserRouter(routes);

/** Application root: gates the admin sections behind sign-in, app-wide providers, and the router. */
export function App(): ReactElement {
  return (
    <AppProviders>
      <AuthGate>
        <RouterProvider router={router} />
      </AuthGate>
    </AppProviders>
  );
}
