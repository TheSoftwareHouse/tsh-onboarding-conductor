import type { components } from '@tsh/openapi';
import type { Applicant } from '../data/applicant';

export type WorkflowStatus = components['schemas']['WorkflowStatus'];

/** How far an onboarding is driven, in the order the workflow takes it. */
export const JOURNEY_STAGES = [
  'started',
  'profile_submitted',
  'email_code_sent',
  'email_verified',
  'document_submitted',
  'identity_parked',
] as const;

export type JourneyStage = (typeof JOURNEY_STAGES)[number];

/** What the identity provider answers when it calls back. */
export type IdentityVerdict = 'approve' | 'review' | 'reject';

export type ReviewDecision = 'approve' | 'reject' | 'invalid';

export type Journey =
  /** Walk the stages up to and including `stage`, then stop. */
  | { kind: 'advance'; stage: JourneyStage }
  /** Request the email code, then answer it wrongly until the engine gives up. */
  | { kind: 'otp-exhausted' }
  /**
   * Park at `check_identity`, then answer as the provider. A `deferred` callback is sent in a later
   * pass, after every other scenario has run; a `review` decision follows a `review` verdict.
   */
  | {
      kind: 'identity-verdict';
      verdict: IdentityVerdict;
      deferred: boolean;
      review?: ReviewDecision;
    };

/** What the engine must report afterwards, and the answer an analyst skill must reach. */
export interface ExpectedOutcome {
  status: WorkflowStatus;
  step: string | null;
  parked: boolean;
  explanation: string;
}

export interface ScenarioPlan {
  /** `<family>-<nn>`, for example `score-reject-03`. */
  key: string;
  family: string;
  applicant: Applicant;
  journey: Journey;
  expected: ExpectedOutcome;
}
