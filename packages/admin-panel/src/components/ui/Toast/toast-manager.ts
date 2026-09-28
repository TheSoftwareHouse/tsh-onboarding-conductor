import { Toast } from '@base-ui/react/toast';

/** The three kinds of mutation outcome the design defines. */
export type ToastKind = 'success' | 'error' | 'progress';

/** The write finished; the design dismisses it quickly. */
export const TOAST_SUCCESS_TIMEOUT_MS = 5_000;
/** The write failed; the design keeps it twice as long since it carries more to read. */
export const TOAST_ERROR_TIMEOUT_MS = 10_000;
/** The write was accepted but finishes later in the background; matches success, not the design's 6 s. */
export const TOAST_PROGRESS_TIMEOUT_MS = 5_000;
/** At most this many toasts show at once; a further one is kept but hidden until one clears. */
export const TOAST_VISIBLE_LIMIT = 3;

/** Module-level, so a mutation handler outside React can raise a toast. */
export const toastManager = Toast.createToastManager();

/** Raises a success toast: announced politely, dismissed after `TOAST_SUCCESS_TIMEOUT_MS`. */
export function showSuccessToast(title: string): void {
  toastManager.add({
    title,
    type: 'success' satisfies ToastKind,
    timeout: TOAST_SUCCESS_TIMEOUT_MS,
  });
}

/** Raises an error toast: announced assertively, dismissed after `TOAST_ERROR_TIMEOUT_MS`. */
export function showErrorToast(title: string, description: string): void {
  toastManager.add({
    title,
    description,
    type: 'error' satisfies ToastKind,
    timeout: TOAST_ERROR_TIMEOUT_MS,
    priority: 'high',
  });
}

/** Raises a progress toast: announced politely, dismissed after `TOAST_PROGRESS_TIMEOUT_MS`. */
export function showProgressToast(title: string): void {
  toastManager.add({
    title,
    type: 'progress' satisfies ToastKind,
    timeout: TOAST_PROGRESS_TIMEOUT_MS,
  });
}
