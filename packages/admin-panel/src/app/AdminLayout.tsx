import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { SessionBar } from '@/features/auth';
import { ADMIN_SECTIONS } from './navigation';

/**
 * Query string each section was last seen with, keyed by section path.
 *
 * Sections carry their committed filters in the URL, and the pages reached from within a section
 * carry the same string, so remembering it is what lets a tab return an operator to the filters
 * they had applied rather than to an unfiltered list.
 *
 * Where the operator has been is a cache rather than state to render from, so it lives in a ref and
 * is recorded once the URL it describes has committed. The section being viewed is read straight
 * off the URL instead, so its own tab always describes the criteria on screen.
 */
function useRememberedSectionSearch(): Record<string, string> {
  const { pathname, search } = useLocation();
  const remembered = useRef<Record<string, string>>({});
  const activeSection = ADMIN_SECTIONS.find((section) => pathname.startsWith(section.path));

  useEffect(() => {
    if (activeSection !== undefined) {
      remembered.current[activeSection.path] = search;
    }
  }, [activeSection, search]);

  return activeSection === undefined
    ? remembered.current
    : { ...remembered.current, [activeSection.path]: search };
}

/** Panel chrome shared by every section: title, session controls, and the section tab bar. */
export function AdminLayout(): ReactElement {
  const rememberedSearch = useRememberedSectionSearch();

  return (
    <div className="page">
      <header className="page-header">
        <h1>Admin panel</h1>
        <SessionBar />
      </header>
      <nav className="tabs" aria-label="Sections">
        {ADMIN_SECTIONS.map((section) => (
          // NavLink marks the matching tab with aria-current="page", which is what styles it.
          <NavLink
            key={section.path}
            to={{ pathname: section.path, search: rememberedSearch[section.path] ?? '' }}
            className="tab"
          >
            {section.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
