import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { AppSidebar } from './AppSidebar';
import { findAdminSection } from '../navigation';

/** Only the section root updates the memory, so a nested page's own params never leak into it. */
function useRememberedSectionSearch(): Record<string, string> {
  const { pathname, search } = useLocation();
  const remembered = useRef<Record<string, string>>({});
  const activeSection = findAdminSection(pathname);
  const sectionRoot = activeSection?.path === pathname ? activeSection.path : undefined;

  useEffect(() => {
    if (sectionRoot !== undefined) {
      remembered.current[sectionRoot] = search;
    }
  }, [sectionRoot, search]);

  return sectionRoot === undefined
    ? remembered.current
    : { ...remembered.current, [sectionRoot]: search };
}

/** Panel chrome shared by every signed-in page: the sidebar and the content. Each page heads itself. */
export function AdminLayout(): ReactElement {
  const rememberedSearch = useRememberedSectionSearch();

  return (
    <div className="flex size-full overflow-hidden bg-bg-page">
      <AppSidebar rememberedSearch={rememberedSearch} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
