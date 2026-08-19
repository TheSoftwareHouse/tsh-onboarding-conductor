import type { ReactElement } from 'react';
import { NavLink, Outlet } from 'react-router';
import { SessionBar } from '@/features/auth';
import { ADMIN_SECTIONS } from './navigation';

/** Panel chrome shared by every section: title, session controls, and the section tab bar. */
export function AdminLayout(): ReactElement {
  return (
    <div className="page">
      <header className="page-header">
        <h1>Admin panel</h1>
        <SessionBar />
      </header>
      <nav className="tabs" aria-label="Sections">
        {ADMIN_SECTIONS.map((section) => (
          // NavLink marks the matching tab with aria-current="page", which is what styles it.
          <NavLink key={section.path} to={section.path} className="tab">
            {section.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
