import type { ReactElement } from 'react';
import { EnvironmentBadge } from './EnvironmentBadge';
import { SessionBar } from './SessionBar/SessionBar';
import { BrandLockup } from '@/components/ui/BrandLockup/BrandLockup';
import { SideNav, SideNavGroup, SideNavItem } from '@/components/ui/SideNav/SideNav';
import { ADMIN_NAV_GROUPS } from '../navigation';

export interface AppSidebarProps {
  /** Query string each section was last seen with, keyed by section path. */
  rememberedSearch: Record<string, string>;
}

/** The panel's fixed left column: what this product is, where to go, and who is signed in. */
export function AppSidebar({ rememberedSearch }: AppSidebarProps): ReactElement {
  return (
    <aside className="flex w-66 flex-none flex-col border-r border-border-rule bg-bg-page">
      <div className="flex h-header flex-none flex-col items-start justify-center gap-2 border-b border-border-rule px-6">
        <BrandLockup />
        <EnvironmentBadge />
      </div>
      <SideNav label="Sections">
        {ADMIN_NAV_GROUPS.map((group) => (
          <SideNavGroup key={group.label} label={group.label}>
            {group.sections.map((section) => (
              <SideNavItem
                key={section.path}
                to={{ pathname: section.path, search: rememberedSearch[section.path] ?? '' }}
                icon={section.icon}
              >
                {section.label}
              </SideNavItem>
            ))}
          </SideNavGroup>
        ))}
      </SideNav>
      <SessionBar />
    </aside>
  );
}
