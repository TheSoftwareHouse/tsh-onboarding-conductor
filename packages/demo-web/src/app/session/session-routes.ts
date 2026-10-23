import { KSA_JOURNEY, type Journey, type SessionView } from '@/api/bnpl/bnpl.client';

export type JourneyPage =
  | 'details'
  | 'consent'
  | 'bank'
  | 'bank/login'
  | 'bank/transfer'
  | 'bank/link'
  | 'bank/waiting'
  | 'accounts'
  | 'bank/consent'
  | 'processing'
  | 'result';

/**
 * The one page ↔ step table, per journey. Each step lists the pages that may show while it is
 * current; the first is where the gate sends a visitor who is on none of them.
 *
 * UK: `bank/transfer` is shown after the login succeeded, when the engine is already on
 * `account_selection`. `credit_check` is current between the access consent and the run, so a
 * reload there stays on the consent page.
 *
 * KSA: `bank_connect` is the Lean widget page until the engine parks (then `bank/waiting`, see
 * `pageFor`); `bank_data_gate` never shows, the BFF walks it; the bank's redirect lands on
 * `bank/waiting` while the engine may already be on `account_selection`.
 */
const STEP_PAGES: Record<Journey, Record<string, readonly JourneyPage[]>> = {
  'uk-algoan': {
    applicant: ['details'],
    credit_consent: ['consent'],
    bank_selection: ['bank'],
    bank_connection: ['bank/login', 'bank/transfer'],
    account_selection: ['accounts', 'bank/transfer'],
    bank_access_consent: ['bank/consent'],
    credit_check: ['bank/consent'],
  },
  'ksa-lean-algoan': {
    applicant: ['details'],
    credit_consent: ['consent'],
    bank_connect: ['bank/link', 'bank/waiting'],
    account_selection: ['accounts', 'bank/waiting'],
    bank_access_consent: ['bank/consent'],
    credit_check: ['bank/consent'],
  },
};

/** The first page of each journey, where "Start over" lands. */
export const FIRST_PAGE: JourneyPage = 'details';

export function sessionPath(token: string, page: JourneyPage): string {
  return `/s/${encodeURIComponent(token)}/${page}`;
}

/** The default page of a step; `details` for a step the table does not know. */
export function stepPath(step: string | null, journey: Journey = 'uk-algoan'): JourneyPage {
  return (step === null ? undefined : STEP_PAGES[journey][step]?.[0]) ?? FIRST_PAGE;
}

/** The page a session belongs on, from the phase, journey and step the BFF reports. */
export function pageFor(view: SessionView): JourneyPage {
  if (view.phase === 'result') {
    return 'result';
  }
  if (view.phase === 'processing') {
    return view.journey === KSA_JOURNEY && view.waitingFor === 'bank'
      ? 'bank/waiting'
      : 'processing';
  }
  if (view.retry === true) {
    return 'accounts';
  }

  return stepPath(view.step, view.journey);
}

/** Whether `page` may show for this session; the gate redirects to `pageFor` when it may not. */
export function isPageFor(view: SessionView, page: JourneyPage): boolean {
  if (view.phase !== 'collect' || view.retry === true) {
    return pageFor(view) === page;
  }

  return (view.step !== null && STEP_PAGES[view.journey][view.step]?.includes(page)) === true;
}
