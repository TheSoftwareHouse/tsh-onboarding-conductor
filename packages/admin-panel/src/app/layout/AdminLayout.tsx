import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { PageHeader } from '@/shared/components/PageHeader/PageHeader';
import { AppSidebar } from './AppSidebar';
import { findAdminSection } from '../navigation';

/**
 * Query string each section was last seen with, keyed by section path.
 *
 * Sections carry their committed filters in the URL, and the pages reached from within a section
 * carry the same string, so remembering it is what lets a sidebar item return an operator to the
 * filters they had applied rather than to an unfiltered list.
 *
 * Where the operator has been is a cache rather than state to render from, so it lives in a ref and
 * is recorded once the URL it describes has committed. The section being viewed is read straight
 * off the URL instead, so its own item always describes the criteria on screen.
 */
function useRememberedSectionSearch(): Record<string, string> {
  const { pathname, search } = useLocation();
  const remembered = useRef<Record<string, string>>({});
  const activeSection = findAdminSection(pathname);

  useEffect(() => {
    if (activeSection !== undefined) {
      remembered.current[activeSection.path] = search;
    }
  }, [activeSection, search]);

  return activeSection === undefined
    ? remembered.current
    : { ...remembered.current, [activeSection.path]: search };
}

/** Panel chrome shared by every signed-in page: the sidebar, the page header, and the content. */
export function AdminLayout(): ReactElement {
  const { pathname } = useLocation();
  const rememberedSearch = useRememberedSectionSearch();
  const section = findAdminSection(pathname);

  return (
    <div className="flex size-full  overflow-hidden bg-bg-page">
      <AppSidebar rememberedSearch={rememberedSearch} />
      <main className="flex min-w-0 flex-1 flex-col">
        {section === undefined ? null : (
          <PageHeader eyebrow={section.group} title={section.label} />
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
