import type { ReactElement } from 'react';
import { AdminAuditPage } from './pages/AdminAuditPage';
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
  { path: '/onboardings', label: 'Onboardings', element: <AdminOnboardingsPage /> },
  { path: '/audit', label: 'Audit log', element: <AdminAuditPage /> },
];

/** Section an operator lands on when no path — or an unknown one — is requested. */
export const DEFAULT_ADMIN_PATH = ADMIN_SECTIONS[0].path;
