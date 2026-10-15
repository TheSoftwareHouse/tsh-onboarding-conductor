import type { SessionView } from '@/api/bnpl/bnpl.client';

export type JourneyPage = 'details' | 'consent' | 'run' | 'processing' | 'result';

const CONSENT_STEP = 'credit_consent';
const APPLICANT_STEP = 'applicant';

export function sessionPath(token: string, page: JourneyPage): string {
  return `/s/${encodeURIComponent(token)}/${page}`;
}

/** The page a session belongs on, from the phase and step the BFF reports. */
export function pageFor(view: SessionView): JourneyPage {
  if (view.phase === 'result') {
    return 'result';
  }
  if (view.phase === 'processing') {
    return 'processing';
  }
  if (view.retry === true || view.step === CONSENT_STEP) {
    return 'consent';
  }
  if (view.step === APPLICANT_STEP) {
    return 'details';
  }

  return 'run';
}
