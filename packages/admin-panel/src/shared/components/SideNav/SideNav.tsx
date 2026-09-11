import type { ReactElement, ReactNode } from 'react';
import { NavLink, type To } from 'react-router';
import { tv } from '../../lib/tv';
import type { IconComponent } from '../icons';
import { Typography } from '../Typography/Typography';

export interface SideNavProps {
  /** Names the landmark, so assistive technology can tell this nav from any other on the page. */
  label: string;
  children: ReactNode;
}

/** Scrolling column of navigation groups, filling the space its sidebar leaves. */
export function SideNav({ label, children }: SideNavProps): ReactElement {
  return (
    <nav aria-label={label} className="flex flex-1 flex-col gap-6 overflow-y-auto py-6">
      {children}
    </nav>
  );
}

export interface SideNavGroupProps {
  label: string;
  children: ReactNode;
}

export function SideNavGroup({ label, children }: SideNavGroupProps): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <Typography variant="caps-tiny" className="px-6 pb-2 text-tsh-gray-400">
        {label}
      </Typography>
      {children}
    </div>
  );
}

const item = tv({
  base: 'flex items-center gap-3 border-l-3 border-l-transparent px-6 py-2.5 text-body-md no-underline hover:bg-bg-subtle',
  variants: {
    active: {
      true: 'border-l-tsh-black bg-bg-alt text-fg-1',
      false: 'text-fg-3',
    },
  },
});

export interface SideNavItemProps {
  to: To;
  icon: IconComponent;
  children: ReactNode;
}

/**
 * One destination. `NavLink` marks it with `aria-current="page"` while it — or a page reached from
 * within it — is being viewed, which is also what styles it as the active item.
 */
export function SideNavItem({ to, icon: Icon, children }: SideNavItemProps): ReactElement {
  return (
    <NavLink to={to} className={({ isActive }) => item({ active: isActive })}>
      <Icon aria-hidden className="size-5 flex-none" />
      {children}
    </NavLink>
  );
}
