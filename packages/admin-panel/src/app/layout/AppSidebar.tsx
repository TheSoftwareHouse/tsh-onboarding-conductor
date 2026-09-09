import type { ReactElement } from 'react';
import { SessionBar } from '@/features/auth';
import { SideNav, SideNavGroup, SideNavItem } from '@/shared/components/SideNav/SideNav';
import { TshSignet } from '@/shared/components/TshSignet/TshSignet';
import { Typography } from '@/shared/components/Typography/Typography';
import { ADMIN_NAV_GROUPS } from '../navigation';

export interface AppSidebarProps {
  /** Query string each section was last seen with, keyed by section path. */
  rememberedSearch: Record<string, string>;
}

/** The panel's fixed left column: what this product is, where to go, and who is signed in. */
export function AppSidebar({ rememberedSearch }: AppSidebarProps): ReactElement {
  return (
    <aside className="flex w-66 flex-none flex-col border-r border-border-rule bg-bg-page">
      <div className="flex h-header flex-none items-center gap-3 border-b border-border-rule px-6">
        <TshSignet className="h-7 w-auto text-tsh-black" />
        <div className="flex flex-col gap-0.5">
          <Typography variant="body-md" className="text-fg-1">
            Conductor
          </Typography>
          <Typography variant="caps-tiny" className="text-fg-4">
            Onboarding ops
          </Typography>
        </div>
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
