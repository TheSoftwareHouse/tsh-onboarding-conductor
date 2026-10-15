import type { SessionView } from '@/api/bnpl/bnpl.client';

export type JourneyPage =
  | 'details'
  | 'consent'
  | 'bank'
  | 'bank/auth'
  | 'bank/login'
  | 'bank/transfer'
  | 'accounts'
  | 'bank/consent'
  | 'processing'
  | 'result';

/**
 * The one page ↔ step table. Each step lists the pages that may show while it is current; the
 * first is where the gate sends a visitor who is on none of them. `bank/transfer` is shown after
 * the login succeeded, when the engine is already on `account_selection`. `credit_check` is
 * current between the access consent and the run, so a reload there stays on the consent page.
 */
const STEP_PAGES: Record<string, readonly JourneyPage[]> = {
  applicant: ['details'],
  credit_consent: ['consent'],
  bank_selection: ['bank'],
  bank_connection: ['bank/auth', 'bank/login', 'bank/transfer'],
  account_selection: ['accounts', 'bank/transfer'],
  bank_access_consent: ['bank/consent'],
  credit_check: ['bank/consent'],
};

export function sessionPath(token: string, page: JourneyPage): string {
  return `/s/${encodeURIComponent(token)}/${page}`;
}

/** The default page of a step; `details` for a step the table does not know. */
export function stepPath(step: string | null): JourneyPage {
  return (step === null ? undefined : STEP_PAGES[step]?.[0]) ?? 'details';
}

/** The page a session belongs on, from the phase and step the BFF reports. */
export function pageFor(view: SessionView): JourneyPage {
  if (view.phase === 'result') {
    return 'result';
  }
  if (view.phase === 'processing') {
    return 'processing';
  }
  if (view.retry === true) {
    return 'accounts';
  }

  return stepPath(view.step);
}

/** Whether `page` may show for this session; the gate redirects to `pageFor` when it may not. */
export function isPageFor(view: SessionView, page: JourneyPage): boolean {
  if (view.phase !== 'collect' || view.retry === true) {
    return pageFor(view) === page;
  }

  return (view.step !== null && STEP_PAGES[view.step]?.includes(page)) === true;
}
