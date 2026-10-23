import { BnplJourney } from '../../config/app.config';
import { PersonaAccountSummary } from '../../personas/persona.service';
import { JsonValue, StateField } from '../../engine/engine.client';

export type Phase = 'collect' | 'processing' | 'result';
export type Decision = 'approved' | 'review' | 'declined';

export interface SessionField {
  name: string;
  type: StateField['type'];
  required: boolean;
  value: JsonValue | null;
}

export interface CreatedSession {
  token: string;
  persona: string | null;
}

/** Which provider a `processing` session waits on: the bank link (Lean) or the credit check. */
export type WaitingFor = 'bank' | 'credit';

export interface SessionView {
  phase: Phase;
  /** The journey this BFF runs; the web app picks its page table from it. */
  journey: BnplJourney;
  /** Set while `processing`: what the engine is parked on. */
  waitingFor?: WaitingFor;
  /** Name of the current step; `null` once the onboarding has ended. */
  step: string | null;
  /** Active fields of the current step; empty outside `collect`. */
  fields: SessionField[];
  data: Record<string, JsonValue>;
  decision?: Decision;
  /** Set when the credit check asked for another attempt; the phase is then `collect`. */
  retry?: true;
  attempt?: number;
  persona: string | null;
  /** Present once the session has a persona; on a result only the accounts the customer selected. */
  accounts?: PersonaAccountSummary[];
}

export interface ProcessingView {
  phase: 'processing';
}

export interface JourneyView {
  journey: BnplJourney;
}
