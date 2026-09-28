import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Toast } from '@base-ui/react/toast';
import { Check, Close, PriorityHigh, Sync, type IconComponent } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { tv } from '@/lib/tv';
import { toastManager, TOAST_VISIBLE_LIMIT, type ToastKind } from './toast-manager';

export interface ToasterProps {
  children: ReactNode;
}

/** Per-kind glyph. */
const TOAST_ICON: Record<ToastKind, IconComponent> = {
  success: Check,
  error: PriorityHigh,
  progress: Sync,
};

/** The icon tile, its glyph and the progress bar, coloured per kind. */
const toastKind = tv({
  slots: {
    tile: 'flex size-6 items-center justify-center',
    glyph: 'size-4.5',
    bar: 'h-full origin-left animate-[toast-progress_var(--toast-timeout)_linear_forwards] group-data-expanded:[animation-play-state:paused] group-data-window-blurred:[animation-play-state:paused] motion-reduce:animate-none',
  },
  variants: {
    kind: {
      success: { tile: 'bg-tsh-teal', glyph: 'text-tsh-black', bar: 'bg-tsh-teal' },
      error: { tile: 'bg-tsh-red', glyph: 'text-tsh-white', bar: 'bg-tsh-red' },
      progress: { tile: 'bg-tsh-blue-300', glyph: 'text-tsh-black', bar: 'bg-tsh-blue-300' },
    },
  },
});

/** Mirrors Base UI's window-blur pause: starts focused and tracks blur only while toasts show. */
function useWindowFocused(hasToasts: boolean): boolean {
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    if (!hasToasts) {
      setFocused(true);
      return undefined;
    }

    const handleBlur = () => setFocused(false);
    const handleFocus = () => setFocused(true);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, [hasToasts]);

  return focused;
}

/** Mounts the toast region around `children`; call the `toast-manager` helpers anywhere below it. */
export function Toaster({ children }: ToasterProps): ReactElement {
  return (
    <Toast.Provider toastManager={toastManager} limit={TOAST_VISIBLE_LIMIT}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="pointer-events-none fixed right-6 bottom-6 z-50 w-100 max-w-[calc(100vw-3rem)]">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList(): ReactElement {
  const { toasts } = Toast.useToastManager();
  const windowFocused = useWindowFocused(toasts.length > 0);

  return (
    <>
      {toasts.map((toast) => {
        const kind = toast.type as ToastKind;
        const Icon = TOAST_ICON[kind];
        const { tile, glyph, bar } = toastKind({ kind });

        return (
          <Toast.Root
            key={toast.id}
            toast={toast}
            swipeDirection={[]}
            // Base UI's stacked-toast recipe (hero example), swipe variables dropped; `data-expanded` spreads the stack.
            className={cn(
              'group pointer-events-auto absolute inset-x-0 bottom-0 origin-bottom',
              'overflow-hidden border border-tsh-gray-300 bg-bg-page font-body',
              '[--gap:0.5rem] [--peek:0.5rem]',
              '[--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]',
              '[--height:var(--toast-frontmost-height,var(--toast-height))]',
              '[--offset-y:calc(var(--toast-offset-y)*-1+(var(--toast-index)*var(--gap)*-1))]',
              'z-[calc(1000-var(--toast-index))] h-(--height)',
              'transform-[translateY(calc((var(--toast-index)*var(--peek)*-1)-(var(--shrink)*var(--height))))_scale(var(--scale))]',
              '[transition:transform_0.5s_cubic-bezier(0.22,1,0.36,1),opacity_0.5s,height_0.15s]',
              'motion-reduce:transition-none',
              'data-expanded:h-(--toast-height) data-expanded:transform-[translateY(var(--offset-y))]',
              'data-ending-style:transform-[translateY(150%)] data-starting-style:transform-[translateY(150%)]',
              'data-ending-style:opacity-0 data-limited:opacity-0',
              "after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+0.0625rem)] after:w-full after:content-['']",
            )}
            data-window-blurred={windowFocused ? undefined : ''}
          >
            <Toast.Content className="grid grid-cols-[1.5rem_minmax(0,1fr)_2rem] items-start gap-x-3 pt-3.5 pr-2 pb-4 pl-4 transition-opacity duration-base ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100 motion-reduce:transition-none">
              <span className={tile()}>
                <Icon className={glyph()} />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                <Toast.Title className="text-body-sm wrap-anywhere text-fg-1">
                  {toast.title}
                </Toast.Title>
                {toast.description ? (
                  <Toast.Description className="text-body-sm wrap-anywhere text-fg-3">
                    {toast.description}
                  </Toast.Description>
                ) : null}
              </div>
              <Toast.Close
                aria-label="Dismiss notification"
                className="-mt-1 flex size-8 items-center justify-center text-fg-4 transition-colors duration-base ease-default hover:text-tsh-black"
              >
                <Close className="size-4.5" />
              </Toast.Close>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-border-hair"
              >
                <div
                  className={bar()}
                  style={{ '--toast-timeout': `${toast.timeout}ms` } as CSSProperties}
                />
              </div>
            </Toast.Content>
          </Toast.Root>
        );
      })}
    </>
  );
}
