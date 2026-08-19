import type { ReactElement } from 'react';
import { ADMIN_ONBOARDINGS_PATH, ONBOARDING_DETAILS_ROUTE } from '@/features/onboarding';
import { AdminAuditPage } from './pages/AdminAuditPage';
import { AdminOnboardingDetailsPage } from './pages/AdminOnboardingDetailsPage';
import { AdminOnboardingsPage } from './pages/AdminOnboardingsPage';

export interface AdminSection {
  /** URL path the section is mounted at. */
  path: string;
  /** Label shown in the tab bar. */
  label: string;
  /** Page rendered inside the admin layout for this path. */
  element: ReactElement;
}

/**
 * Every page the panel exposes, in tab order. Both the tab bar and the router are built from
 * this list, so a new section is added by appending one entry here.
 */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { path: ADMIN_ONBOARDINGS_PATH, label: 'Onboardings', element: <AdminOnboardingsPage /> },
  { path: '/audit', label: 'Audit log', element: <AdminAuditPage /> },
];

export interface AdminRoute {
  /** URL pattern the page is mounted at, including its route parameters. */
  path: string;
  /** Page rendered inside the admin layout for this pattern. */
  element: ReactElement;
}

/**
 * Pages reached from within a section rather than from the tab bar. They render in the same
 * layout, and the tab of the section they belong to stays marked because its path is their prefix.
 */
export const ADMIN_DETAIL_ROUTES: readonly AdminRoute[] = [
  { path: ONBOARDING_DETAILS_ROUTE, element: <AdminOnboardingDetailsPage /> },
];

/** Section an operator lands on when no path — or an unknown one — is requested. */
export const DEFAULT_ADMIN_PATH = ADMIN_SECTIONS[0].path;
