import type { ComponentType, ReactElement } from 'react';
import type { AdminPageProps } from '@/lib/admin-page';
import { ADMIN_ROUTES } from '@/constants/routes';
import {
  AccountTree,
  AssignmentTurnedIn,
  Cable,
  ReceiptLong,
  VpnKey,
  type IconComponent,
} from '@/components/ui/icons';
import { AuditPage } from './audit/AuditPage';
import { ConnectorsPage } from './connectors/ConnectorsPage';
import { EncryptionPage } from './encryption/EncryptionPage';
import { OnboardingDetailsPage } from './onboardings/details/OnboardingDetailsPage';
import { OnboardingsPage } from './onboardings/OnboardingsPage';
import { WorkflowDetailsPage } from './workflows/details/WorkflowDetailsPage';
import { WorkflowsPage } from './workflows/WorkflowsPage';

export interface AdminSection {
  /** URL path the section is mounted at. */
  path: string;
  /** Label shown in the sidebar, and handed to the page as its title. */
  label: string;
  /** Sidebar group the section sits under, handed to the page as its header's eyebrow. */
  group: string;
  /** Icon shown beside the label in the sidebar. */
  icon: IconComponent;
  /** Page rendered inside the admin layout for this path, headed by its own `PageHeader`. */
  Component: ComponentType<AdminPageProps>;
}

/**
 * Every page the panel exposes, in sidebar order. Both the sidebar and the router are built from
 * this list, so a new section is added by appending one entry here.
 */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    path: ADMIN_ROUTES.onboardings.root,
    label: 'Onboardings',
    group: 'Monitor',
    icon: AssignmentTurnedIn,
    Component: OnboardingsPage,
  },
  {
    path: ADMIN_ROUTES.audit.root,
    label: 'Logs',
    group: 'Monitor',
    icon: ReceiptLong,
    Component: AuditPage,
  },
  {
    path: ADMIN_ROUTES.workflows.root,
    label: 'Workflows',
    group: 'Build',
    icon: AccountTree,
    Component: WorkflowsPage,
  },
  {
    path: ADMIN_ROUTES.connectors.root,
    label: 'Connectors',
    group: 'Build',
    icon: Cable,
    Component: ConnectorsPage,
  },
  {
    path: ADMIN_ROUTES.encryption.root,
    label: 'Encryption',
    group: 'Build',
    icon: VpnKey,
    Component: EncryptionPage,
  },
];

export interface AdminNavGroup {
  label: string;
  sections: readonly AdminSection[];
}

/** `ADMIN_SECTIONS` folded into the sidebar's groups, each group placed where it first appears. */
export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  ...new Set(ADMIN_SECTIONS.map((section) => section.group)),
].map((label) => ({
  label,
  sections: ADMIN_SECTIONS.filter((section) => section.group === label),
}));

/** The section a path belongs to: its own, or that of the section it was reached from. */
export function findAdminSection(pathname: string): AdminSection | undefined {
  return ADMIN_SECTIONS.find((section) => pathname.startsWith(section.path));
}

export interface AdminRoute {
  /** URL pattern the page is mounted at, including its route parameters. */
  path: string;
  /** Page rendered inside the admin layout for this pattern. */
  element: ReactElement;
}

/**
 * Pages reached from within a section rather than from the sidebar. They render in the same
 * layout, and the item of the section they belong to stays marked because its path is their prefix.
 */
export const ADMIN_DETAIL_ROUTES: readonly AdminRoute[] = [
  { path: ADMIN_ROUTES.onboardings.detailsPattern, element: <OnboardingDetailsPage /> },
  { path: ADMIN_ROUTES.workflows.detailsPattern, element: <WorkflowDetailsPage /> },
];

/** Section an operator lands on when no path — or an unknown one — is requested. */
export const DEFAULT_ADMIN_PATH = ADMIN_SECTIONS[0].path;
