import type { ReactElement, ReactNode } from 'react';

export interface PageBodyProps {
  children: ReactNode;
}

/**
 * The padded, scrolling body `AdminLayout`'s outlet used to apply to every page. A page that draws
 * the design's edge-to-edge bands renders directly in the unpadded outlet instead.
 */
export function PageBody({ children }: PageBodyProps): ReactElement {
  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-8">{children}</div>;
}
