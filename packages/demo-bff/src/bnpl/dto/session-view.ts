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

export interface SessionView {
  phase: Phase;
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
