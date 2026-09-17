import type { ReactElement, ReactNode } from 'react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { requestPageHeaderActionsSlot, usePageHeaderActionsContainer } from '../PageHeader';

export interface PageHeaderActionsProps {
  children: ReactNode;
}

/**
 * Portals a routed page's own header controls into the mounted `PageHeader`'s action slot, so
 * `AdminLayout` never needs to know which page is mounted to render its actions.
 */
export function PageHeaderActions({ children }: PageHeaderActionsProps): ReactElement | null {
  useEffect(() => requestPageHeaderActionsSlot(), []);
  const container = usePageHeaderActionsContainer();

  return container === null ? null : createPortal(children, container);
}
