import type { ReactElement, ReactNode } from 'react';
import { useCallback, useSyncExternalStore } from 'react';
import { Typography } from '../Typography/Typography';

export interface PageHeaderProps {
  /** Line above the title naming where the page sits, such as the section group it belongs to. */
  eyebrow?: string;
  title: string;
  /** Controls shown opposite the title, such as an export or reload button. */
  children?: ReactNode;
}

/**
 * The action slot's demand and its rendered DOM node, shared with `PageHeaderActions` as a module
 * singleton rather than React context: `PageHeader` and `PageHeaderActions` sit in different
 * branches of the tree (the header is mounted by `AdminLayout`, the actions by the routed page), and
 * only one `PageHeader` is ever mounted at a time.
 */
interface ActionsSlotState {
  requestCount: number;
  container: HTMLDivElement | null;
}

let actionsSlotState: ActionsSlotState = { requestCount: 0, container: null };
const actionsSlotListeners = new Set<() => void>();

function emitActionsSlotChange(): void {
  for (const listener of actionsSlotListeners) listener();
}

function subscribeToActionsSlot(listener: () => void): () => void {
  actionsSlotListeners.add(listener);
  return () => {
    actionsSlotListeners.delete(listener);
  };
}

function getActionsSlotSnapshot(): ActionsSlotState {
  return actionsSlotState;
}

/** Registers a mounted `PageHeaderActions`' demand for the header's action slot. */
export function requestPageHeaderActionsSlot(): () => void {
  actionsSlotState = { ...actionsSlotState, requestCount: actionsSlotState.requestCount + 1 };
  emitActionsSlotChange();
  return () => {
    actionsSlotState = { ...actionsSlotState, requestCount: actionsSlotState.requestCount - 1 };
    emitActionsSlotChange();
  };
}

/** The action slot's current DOM node, or `null` until a `PageHeader` renders it. */
export function usePageHeaderActionsContainer(): HTMLDivElement | null {
  return useSyncExternalStore(
    subscribeToActionsSlot,
    getActionsSlotSnapshot,
    getActionsSlotSnapshot,
  ).container;
}

/** A page's own header band: where the operator is, and the actions that page offers. */
export function PageHeader({ eyebrow, title, children }: PageHeaderProps): ReactElement {
  const { requestCount } = useSyncExternalStore(
    subscribeToActionsSlot,
    getActionsSlotSnapshot,
    getActionsSlotSnapshot,
  );
  const setContainer = useCallback((node: HTMLDivElement | null) => {
    actionsSlotState = { ...actionsSlotState, container: node };
    emitActionsSlotChange();
  }, []);
  const showActions = children !== undefined || requestCount > 0;

  return (
    <header className="flex min-h-header flex-none flex-wrap items-center justify-between gap-x-6 gap-y-4 border-b border-border-rule px-8 py-4">
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow === undefined ? null : (
          <Typography variant="caps-tiny" className="text-fg-4">
            {eyebrow}
          </Typography>
        )}
        <Typography variant="h5" as="h1">
          {title}
        </Typography>
      </div>
      {showActions ? (
        <div ref={setContainer} className="flex flex-none items-center gap-3">
          {children}
        </div>
      ) : null}
    </header>
  );
}
