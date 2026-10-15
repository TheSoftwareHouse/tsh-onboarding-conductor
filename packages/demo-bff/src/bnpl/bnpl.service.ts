import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { EngineError } from '../engine/engine-error';
import { EngineClient, OnboardingState } from '../engine/engine.client';
import { PersonaNotFoundError, PersonaService } from '../personas/persona.service';
import { BankDataPusher } from './bank-data-pusher';
import { BnplSession, BnplSessionStore } from './bnpl-session.store';
import { CreatedSession, Decision, ProcessingView, SessionView } from './dto/session-view';
import { EngineUnavailableException } from './errors/engine-unavailable.exception';
import { InvalidStepDataException } from './errors/invalid-step-data.exception';
import { SessionConflictException } from './errors/session-conflict.exception';
import { SessionNotFoundException } from './errors/session-not-found.exception';
import { UnknownPersonaException } from './errors/unknown-persona.exception';
import { StateWaiter } from './state-waiter';

const MILLISECONDS_PER_SECOND = 1000;
const POLL_SECONDS = 2;
export const POLL_INTERVAL_MS = POLL_SECONDS * MILLISECONDS_PER_SECOND;

const AWAITING_CONNECTOR = 'ONBOARDING_AWAITING_CONNECTOR';
const CREDIT_OUTCOME_FIELD = 'creditOutcome';
const CREDIT_ATTEMPT_COUNT_FIELD = 'creditAttemptCount';
const CREDIT_OUTCOME_RETRY = 'retry';
const DECISIONS: readonly Decision[] = ['approved', 'review', 'declined'];

/**
 * Every engine code this BFF knows, each decided on purpose. A code absent here is a defect or an
 * engine change: it answers 502 and is logged, and the spec fails on a table that drifts.
 */
export const ENGINE_ERROR_MAP: Record<string, (error: EngineError) => HttpException> = {
  INVALID_STEP_DATA: (error) => new InvalidStepDataException(error.errors),
  ONBOARDING_NOT_FOUND: () => new SessionNotFoundException(),
  ONBOARDING_COMPLETED: () => new SessionConflictException(),
  MANUAL_TRANSITION_NOT_AVAILABLE: () => new SessionConflictException(),
  UNKNOWN_WORKFLOW_EVALUATION: () => new SessionConflictException(),
  // The workflow id is this BFF's own configuration, not the caller's input.
  WORKFLOW_NOT_FOUND: () => new EngineUnavailableException(),
  WORKFLOW_RETIRED: () => new EngineUnavailableException(),
  // An operator has not supplied a credential.
  CONNECTOR_NOT_CONFIGURED: () => new EngineUnavailableException(),
  AGREEMENT_NOT_PUBLISHED: () => new EngineUnavailableException(),
  // The caller has no document to re-reserve or accept on this surface.
  INVALID_DOCUMENT_UPLOAD: () => new EngineUnavailableException(),
  DOCUMENT_UPLOAD_NOT_FOUND: () => new EngineUnavailableException(),
  DOCUMENT_UPLOAD_CONFLICT: () => new EngineUnavailableException(),
  DOCUMENT_UPLOAD_EXPIRED: () => new EngineUnavailableException(),
};

@Injectable()
export class BnplService {
  private readonly logger = new Logger(BnplService.name);
  private readonly workflowId: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly engine: EngineClient,
    private readonly store: BnplSessionStore,
    private readonly waiter: StateWaiter,
    private readonly personas: PersonaService,
    private readonly pusher: BankDataPusher,
  ) {
    this.workflowId = config.get('BNPL_WORKFLOW_ID', { infer: true });
  }

  async createSession(persona: string): Promise<CreatedSession> {
    try {
      this.personas.accounts(persona);
    } catch (error) {
      throw error instanceof PersonaNotFoundError ? new UnknownPersonaException() : error;
    }

    const { onboardingId } = await this.guarded(() => this.engine.startOnboarding(this.workflowId));
    const token = this.store.create(onboardingId, persona);

    return { token, persona };
  }

  /** Test-only lookup behind a route that is closed outside `NODE_ENV=test`. */
  onboardingIdOf(token: string): string {
    return this.requireSession(token).onboardingId;
  }

  async getSession(token: string, waitSeconds = 0): Promise<SessionView> {
    const session = this.requireSession(token);
    const state = await this.waiter.waitFor(session.onboardingId, {
      fetch: () => this.guarded(() => this.engine.getState(session.onboardingId)),
      isSettled: (current) => phaseOf(current) !== 'processing',
      timeoutMs: waitSeconds * MILLISECONDS_PER_SECOND,
      pollMs: POLL_INTERVAL_MS,
    });

    return this.view(session, state);
  }

  async submit(
    token: string,
    values: Record<string, unknown>,
  ): Promise<SessionView | ProcessingView> {
    const session = this.requireSession(token);

    try {
      await this.engine.submit(session.onboardingId, values);
    } catch (error) {
      return this.processingOrThrow(error);
    }

    return this.currentView(session);
  }

  async run(token: string): Promise<ProcessingView> {
    const session = this.requireSession(token);

    try {
      await this.pusher.push(session.onboardingId, session.persona);
    } catch (error) {
      return this.processingOrThrow(error);
    }

    return { phase: 'processing' };
  }

  private requireSession(token: string): BnplSession {
    const session = this.store.get(token);

    if (session === undefined) {
      throw new SessionNotFoundException();
    }

    return session;
  }

  private async currentView(session: BnplSession): Promise<SessionView> {
    const state = await this.guarded(() => this.engine.getState(session.onboardingId));

    return this.view(session, state);
  }

  private view(session: BnplSession, state: OnboardingState): SessionView {
    const phase = phaseOf(state);
    const outcome = state.data[CREDIT_OUTCOME_FIELD];
    const attempt = state.data[CREDIT_ATTEMPT_COUNT_FIELD];
    const view: SessionView = {
      phase,
      step: state.step?.name ?? null,
      fields:
        phase === 'collect'
          ? (state.step?.fields ?? [])
              .filter((field) => field.active)
              .map(({ name, type, required, value }) => ({ name, type, required, value }))
          : [],
      data: state.data,
      persona: session.persona,
      accounts: this.personas.accounts(session.persona),
    };

    if (phase === 'result') {
      view.decision = decisionOf(state);
    } else if (phase === 'collect' && outcome === CREDIT_OUTCOME_RETRY) {
      view.retry = true;
      if (typeof attempt === 'number') {
        view.attempt = attempt;
      }
    }

    return view;
  }

  private processingOrThrow(error: unknown): ProcessingView {
    if (error instanceof EngineError && error.code === AWAITING_CONNECTOR) {
      return { phase: 'processing' };
    }

    throw this.toException(error);
  }

  private async guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw this.toException(error);
    }
  }

  private toException(error: unknown): unknown {
    if (!(error instanceof EngineError)) {
      return error;
    }

    const mapped = error.code === undefined ? undefined : ENGINE_ERROR_MAP[error.code];

    if (mapped !== undefined) {
      return mapped(error);
    }

    this.logger.warn(
      `Unmapped engine failure (status ${error.status ?? 'transport'}, code ${error.code ?? 'none'}): ${error.message}`,
    );

    return new EngineUnavailableException();
  }
}

export function phaseOf(state: OnboardingState): SessionView['phase'] {
  if (state.pending !== null) {
    return 'processing';
  }

  if (state.data[CREDIT_OUTCOME_FIELD] === CREDIT_OUTCOME_RETRY && !state.terminal) {
    return 'collect';
  }

  if (state.terminal || state.data[CREDIT_OUTCOME_FIELD] !== undefined) {
    return 'result';
  }

  return 'collect';
}

/** A finished onboarding speaks for itself; otherwise the credit outcome is the decision. */
function decisionOf(state: OnboardingState): Decision {
  if (state.terminal && state.status === 'approved') {
    return 'approved';
  }

  if (state.terminal && state.status === 'rejected') {
    return 'declined';
  }

  const outcome = state.data[CREDIT_OUTCOME_FIELD];

  return DECISIONS.find((decision) => decision === outcome) ?? 'review';
}
