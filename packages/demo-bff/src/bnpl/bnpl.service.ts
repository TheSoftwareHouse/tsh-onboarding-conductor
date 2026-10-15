import { randomUUID } from 'node:crypto';

import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { EngineError } from '../engine/engine-error';
import { EngineClient, OnboardingState } from '../engine/engine.client';
import {
  PersonaAccountSummary,
  PersonaNotFoundError,
  PersonaService,
} from '../personas/persona.service';
import { BankDataPusher } from './bank-data-pusher';
import { BnplSession, BnplSessionStore } from './bnpl-session.store';
import { BankConnectionMethod } from './dto/bank-login.dto';
import { CreatedSession, Decision, ProcessingView, SessionView } from './dto/session-view';
import { AccountsNotSelectedException } from './errors/accounts-not-selected.exception';
import { EngineUnavailableException } from './errors/engine-unavailable.exception';
import { InvalidStepDataException } from './errors/invalid-step-data.exception';
import { SessionConflictException } from './errors/session-conflict.exception';
import { SessionHasNoBankException } from './errors/session-has-no-bank.exception';
import { SessionNotFoundException } from './errors/session-not-found.exception';
import { StepNotReadyException } from './errors/step-not-ready.exception';
import { UnknownPersonaException } from './errors/unknown-persona.exception';
import { StateWaiter } from './state-waiter';

const MILLISECONDS_PER_SECOND = 1000;
const POLL_SECONDS = 2;
export const POLL_INTERVAL_MS = POLL_SECONDS * MILLISECONDS_PER_SECOND;

const AWAITING_CONNECTOR = 'ONBOARDING_AWAITING_CONNECTOR';
const CREDIT_OUTCOME_FIELD = 'creditOutcome';
const CREDIT_ATTEMPT_COUNT_FIELD = 'creditAttemptCount';
const CREDIT_OUTCOME_RETRY = 'retry';
const BANK_CONNECTION_STEP = 'bank_connection';
const SELECTED_ACCOUNTS_FIELD = 'selectedAccounts';
const CHECKING_ACCOUNT_REQUIRED = 'CHECKING_ACCOUNT_REQUIRED';
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
  // The only reservation this BFF makes is the bank data one, with a fixed content type and a size
  // the persona files bound, so a refusal means the current step does not take that document.
  INVALID_DOCUMENT_UPLOAD: () => new StepNotReadyException(),
  // The caller has no document to re-reserve or accept on this surface.
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

  async createSession(persona?: string): Promise<CreatedSession> {
    if (persona !== undefined) {
      this.requirePersona(persona);
    }

    const { onboardingId } = await this.guarded(() => this.engine.startOnboarding(this.workflowId));
    const token = this.store.create(onboardingId, persona ?? null);

    return { token, persona: persona ?? null };
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

    this.requireCheckingAccount(session, values);

    try {
      await this.engine.submit(session.onboardingId, values);
    } catch (error) {
      return this.processingOrThrow(error);
    }

    return this.currentView(session);
  }

  /**
   * Records the simulated bank login: the persona the customer picked at the bank becomes the
   * session's persona, and the engine learns only an opaque reference, the method and the profile.
   * The current step is read to produce `SESSION_HAS_NO_BANK`, never to branch the flow.
   */
  async bankLogin(
    token: string,
    persona: string,
    method: BankConnectionMethod,
  ): Promise<SessionView> {
    const session = this.requireSession(token);
    const { profile } = this.requirePersona(persona);
    const state = await this.guarded(() => this.engine.getState(session.onboardingId));

    if (state.step?.name !== BANK_CONNECTION_STEP) {
      throw new SessionHasNoBankException();
    }

    await this.guarded(() =>
      this.engine.submit(session.onboardingId, {
        bankConnectionReference: randomUUID().replaceAll('-', ''),
        bankConnectionMethod: method,
        bankProfile: profile,
      }),
    );
    // Only once the engine recorded the profile: a refused submit must not change which persona's
    // bank data the run pushes.
    session.persona = persona;

    return this.currentView(session);
  }

  async run(token: string): Promise<ProcessingView> {
    const session = this.requireSession(token);
    const state = await this.guarded(() => this.engine.getState(session.onboardingId));
    const selected = selectedAccountIds(state);

    if (session.persona === null || selected.length === 0) {
      throw new AccountsNotSelectedException();
    }

    try {
      await this.pusher.push(session.onboardingId, session.persona, selected);
    } catch (error) {
      return this.processingOrThrow(error);
    }

    return { phase: 'processing' };
  }

  private requirePersona(persona: string) {
    try {
      return this.personas.summary(persona);
    } catch (error) {
      throw error instanceof PersonaNotFoundError ? new UnknownPersonaException() : error;
    }
  }

  /** Mirrors the provider's own check so a selection without a current account is never paid for. */
  private requireCheckingAccount(session: BnplSession, values: Record<string, unknown>): void {
    const selected = values[SELECTED_ACCOUNTS_FIELD];

    if (session.persona === null || !Array.isArray(selected)) {
      return;
    }

    const hasChecking = this.personas
      .accounts(session.persona)
      .some((account) => account.type === 'CHECKING' && selected.includes(account.id));

    if (!hasChecking) {
      throw new InvalidStepDataException({
        [SELECTED_ACCOUNTS_FIELD]: [CHECKING_ACCOUNT_REQUIRED],
      });
    }
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
    };

    if (session.persona !== null) {
      view.accounts = visibleAccounts(
        this.personas.accounts(session.persona),
        phase === 'result' ? selectedAccountIds(state) : undefined,
      );
    }

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

/** The engine is the source of truth for the selection; `clientVisible` makes it readable. */
function selectedAccountIds(state: OnboardingState): string[] {
  const selected = state.data[SELECTED_ACCOUNTS_FIELD];

  return Array.isArray(selected)
    ? selected.filter((id): id is string => typeof id === 'string')
    : [];
}

function visibleAccounts(
  accounts: PersonaAccountSummary[],
  selected: string[] | undefined,
): PersonaAccountSummary[] {
  return selected === undefined
    ? accounts
    : accounts.filter((account) => selected.includes(account.id));
}
