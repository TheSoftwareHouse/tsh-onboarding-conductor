import { randomUUID } from 'node:crypto';

import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfig, BnplJourney, KSA_JOURNEY } from '../config/app.config';
import { EngineError } from '../engine/engine-error';
import { EngineClient, JsonValue, OnboardingState } from '../engine/engine.client';
import {
  LEAN_REDIRECT_FAIL,
  LEAN_REDIRECT_QUERY,
  LEAN_REDIRECT_SUCCESS,
  LeanLink,
  LeanLinkService,
} from '../lean/lean-link.service';
import {
  PersonaAccountSummary,
  PersonaNotFoundError,
  PersonaService,
} from '../personas/persona.service';
import { BankDataPusher } from './bank-data-pusher';
import { BnplSession, BnplSessionStore } from './bnpl-session.store';
import { BankConnectionMethod } from './dto/bank-login.dto';
import {
  CreatedSession,
  Decision,
  ProcessingView,
  SessionView,
  WaitingFor,
} from './dto/session-view';
import { AccountsNotSelectedException } from './errors/accounts-not-selected.exception';
import { CreditCheckUnavailableException } from './errors/credit-check-unavailable.exception';
import { EngineUnavailableException } from './errors/engine-unavailable.exception';
import { InvalidStepDataException } from './errors/invalid-step-data.exception';
import { SessionConflictException } from './errors/session-conflict.exception';
import { SessionHasNoBankException } from './errors/session-has-no-bank.exception';
import { SessionNotFoundException } from './errors/session-not-found.exception';
import { SessionStepNotSubmittableException } from './errors/session-step-not-submittable.exception';
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
const BANK_CONNECT_STEP = 'bank_connect';
const BANK_DATA_GATE_STEP = 'bank_data_gate';
const CREDIT_CHECK_STEP = 'credit_check';
const LEAN_CUSTOMER_ID_FIELD = 'leanCustomerId';
const LEAN_BANK_DATA_CONNECTOR_ID = 'lean_bank_data';
/** The `json` summary `lean_bank_data` writes (ADR 0050), the KSA journey's account list. */
const BANK_ACCOUNTS_FIELD = 'bankAccounts';
/** The steps this BFF records through a route of its own; `submit` refuses them. */
const OWNED_STEPS: Readonly<Record<BnplJourney, Readonly<Record<string, string>>>> = {
  'uk-algoan': { [BANK_CONNECTION_STEP]: 'bank-login', [CREDIT_CHECK_STEP]: 'run' },
  'ksa-lean-algoan': { [BANK_CONNECT_STEP]: 'bank-link', [CREDIT_CHECK_STEP]: 'run' },
};
/**
 * Steps the BFF advances itself with an empty submit as soon as it sees them, so the web app
 * never does: `bank_data_gate` is a `decision` step, which routes only on a submit (ADR 0052).
 */
const PASS_THROUGH_STEPS: Readonly<Record<BnplJourney, readonly string[]>> = {
  'uk-algoan': [],
  'ksa-lean-algoan': [BANK_DATA_GATE_STEP],
};
/** How many pass-through steps in a row the BFF will walk before answering what it has. */
const MAX_PASS_THROUGH = 3;
const SELECTED_ACCOUNTS_FIELD = 'selectedAccounts';
const CHECKING_ACCOUNT_REQUIRED = 'CHECKING_ACCOUNT_REQUIRED';
const DECISIONS: readonly Decision[] = ['approved', 'review', 'declined'];
/** Where the bank sends the applicant back; the web app's route for the parked bank link. */
const BANK_WAITING_PAGE = 'bank/waiting';

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
  // The provider refused the engine's credentials or the assessment: not the customer's to fix.
  CREDIT_PROVIDER_CREDENTIALS_REJECTED: () => new CreditCheckUnavailableException(),
  CREDIT_PROVIDER_REJECTED: () => new CreditCheckUnavailableException(),
  // Lean refused the engine's reads on the KSA journey: not the customer's to fix.
  LEAN_UNAVAILABLE: () => new CreditCheckUnavailableException(),
};

@Injectable()
export class BnplService {
  private readonly logger = new Logger(BnplService.name);
  private readonly workflowId: string;
  private readonly journey: BnplJourney;
  private readonly publicWebOrigin: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly engine: EngineClient,
    private readonly store: BnplSessionStore,
    private readonly waiter: StateWaiter,
    private readonly personas: PersonaService,
    private readonly pusher: BankDataPusher,
    private readonly leanLink: LeanLinkService,
  ) {
    this.workflowId = config.get('BNPL_WORKFLOW_ID', { infer: true });
    this.journey = config.get('BNPL_JOURNEY', { infer: true });
    this.publicWebOrigin = (config.get('DEMO_WEB_PUBLIC_ORIGIN', { infer: true }) ?? '').replace(
      /\/+$/,
      '',
    );
  }

  journeyOf(): BnplJourney {
    return this.journey;
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
      fetch: () => this.readState(session.onboardingId),
      isSettled: (current) => phaseOf(current) !== 'processing',
      timeoutMs: waitSeconds * MILLISECONDS_PER_SECOND,
      pollMs: POLL_INTERVAL_MS,
    });

    return this.view(session, state);
  }

  /**
   * Pushes the current step's values. The two steps this BFF records itself are refused first, so
   * a caller cannot set the bank profile behind the session's persona or run the credit check
   * without the persona's bank data.
   */
  async submit(
    token: string,
    values: Record<string, unknown>,
  ): Promise<SessionView | ProcessingView> {
    const session = this.requireSession(token);
    const state = await this.readState(session.onboardingId);
    const step = state.step?.name;
    const owningRoute = step === undefined ? undefined : OWNED_STEPS[this.journey][step];

    if (step !== undefined && owningRoute !== undefined) {
      throw new SessionStepNotSubmittableException(step, owningRoute);
    }

    this.requireCheckingAccount(session, state, values);

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
    const { profile } = this.requireUkPersona(persona);
    const state = await this.readState(session.onboardingId);

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

  /**
   * The KSA journey's bank link (ADR 0052): the BFF, as Lean's host service, creates the Lean
   * customer for the onboarding, submits its id so the engine parks `bank_connect`, and answers
   * what `Lean.connect` needs. A second call while the step is already parked (the bank refused
   * the first attempt) mints a fresh token for the same customer and leaves the park alone.
   */
  async bankLink(token: string): Promise<LeanLink> {
    const session = this.requireSession(token);
    const state = await this.readState(session.onboardingId);

    if (state.step?.name !== BANK_CONNECT_STEP) {
      throw new SessionHasNoBankException();
    }

    const link = await this.leanLink.createLink(session.onboardingId, {
      success: this.redirectUrl(token, LEAN_REDIRECT_SUCCESS),
      fail: this.redirectUrl(token, LEAN_REDIRECT_FAIL),
    });

    if (state.pending === null) {
      try {
        await this.engine.submit(session.onboardingId, {
          [LEAN_CUSTOMER_ID_FIELD]: link.customerId,
        });
      } catch (error) {
        if (!(error instanceof EngineError && error.code === AWAITING_CONNECTOR)) {
          throw this.toException(error);
        }
      }
    }

    return link;
  }

  /**
   * Starts the credit check. On the UK journey the persona's selected accounts are uploaded as
   * the `bankData` document; on the KSA journey the engine already holds Lean's export, so the
   * step is started with an empty submit (ADR 0051).
   */
  async run(token: string): Promise<ProcessingView> {
    const session = this.requireSession(token);
    const state = await this.readState(session.onboardingId);
    const selected = selectedAccountIds(state);

    if (selected.length === 0) {
      throw new AccountsNotSelectedException();
    }

    if (this.journey === KSA_JOURNEY) {
      try {
        await this.engine.submit(session.onboardingId, {});
      } catch (error) {
        return this.processingOrThrow(error);
      }

      return { phase: 'processing' };
    }

    if (session.persona === null) {
      throw new AccountsNotSelectedException();
    }

    try {
      await this.pusher.push(session.onboardingId, session.persona, selected);
    } catch (error) {
      return this.processingOrThrow(error);
    }

    return { phase: 'processing' };
  }

  /** The KSA journey has no personae at all: the mock-bank login decides the data. */
  private requirePersona(persona: string): void {
    if (this.journey === KSA_JOURNEY) {
      throw new UnknownPersonaException();
    }

    this.requireUkPersona(persona);
  }

  private requireUkPersona(persona: string) {
    try {
      return this.personas.summary(persona);
    } catch (error) {
      throw error instanceof PersonaNotFoundError ? new UnknownPersonaException() : error;
    }
  }

  /**
   * The engine's state, with any pass-through step of the journey already advanced: a `decision`
   * step routes only on a submit, and nothing on the web app's side has anything to say on it.
   */
  private async readState(onboardingId: string): Promise<OnboardingState> {
    let state = await this.guarded(() => this.engine.getState(onboardingId));

    for (let walked = 0; walked < MAX_PASS_THROUGH; walked += 1) {
      const step = state.step?.name;

      if (
        step === undefined ||
        state.pending !== null ||
        state.terminal ||
        !PASS_THROUGH_STEPS[this.journey].includes(step)
      ) {
        return state;
      }

      await this.guarded(() => this.engine.submit(onboardingId, {}));
      state = await this.guarded(() => this.engine.getState(onboardingId));
    }

    return state;
  }

  /** Mirrors the provider's own check so a selection without a current account is never paid for. */
  private requireCheckingAccount(
    session: BnplSession,
    state: OnboardingState,
    values: Record<string, unknown>,
  ): void {
    const selected = values[SELECTED_ACCOUNTS_FIELD];

    if (!Array.isArray(selected)) {
      return;
    }

    const accounts = this.accountsOf(session, state);

    if (accounts === undefined) {
      return;
    }

    const hasChecking = accounts.some(
      (account) => account.type === 'CHECKING' && selected.includes(account.id),
    );

    if (!hasChecking) {
      throw new InvalidStepDataException({
        [SELECTED_ACCOUNTS_FIELD]: [CHECKING_ACCOUNT_REQUIRED],
      });
    }
  }

  /**
   * The accounts the session can choose from: the persona file's on the UK journey, the summary
   * Lean's export wrote on the KSA one. `undefined` while neither exists yet.
   */
  private accountsOf(
    session: BnplSession,
    state: OnboardingState,
  ): PersonaAccountSummary[] | undefined {
    if (this.journey === KSA_JOURNEY) {
      return exportedAccounts(state);
    }

    return session.persona === null ? undefined : this.personas.accounts(session.persona);
  }

  private redirectUrl(token: string, outcome: string): string {
    const url = new URL(
      `${this.publicWebOrigin}/s/${encodeURIComponent(token)}/${BANK_WAITING_PAGE}`,
    );
    url.searchParams.set(LEAN_REDIRECT_QUERY, outcome);

    return url.toString();
  }

  private requireSession(token: string): BnplSession {
    const session = this.store.get(token);

    if (session === undefined) {
      throw new SessionNotFoundException();
    }

    return session;
  }

  private async currentView(session: BnplSession): Promise<SessionView> {
    const state = await this.readState(session.onboardingId);

    return this.view(session, state);
  }

  private view(session: BnplSession, state: OnboardingState): SessionView {
    const phase = phaseOf(state);
    const outcome = state.data[CREDIT_OUTCOME_FIELD];
    const attempt = state.data[CREDIT_ATTEMPT_COUNT_FIELD];
    const view: SessionView = {
      phase,
      journey: this.journey,
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

    if (phase === 'processing' && state.pending !== null) {
      view.waitingFor = waitingForOf(state.pending.connectorId);
    }

    const accounts = this.accountsOf(session, state);

    if (accounts !== undefined) {
      view.accounts = visibleAccounts(
        accounts,
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

function waitingForOf(connectorId: string): WaitingFor {
  return connectorId === LEAN_BANK_DATA_CONNECTOR_ID ? 'bank' : 'credit';
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

const isRecord = (value: JsonValue | undefined): value is { [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `/state.data.bankAccounts.accounts` as the web app's account list: the positions Lean's export
 * assigned, the type, name, masked number, balance and currency in the document's currency, the
 * bank. `undefined` before the export exists.
 */
function exportedAccounts(state: OnboardingState): PersonaAccountSummary[] | undefined {
  const summary = state.data[BANK_ACCOUNTS_FIELD];

  if (!isRecord(summary) || !Array.isArray(summary.accounts)) {
    return undefined;
  }

  return summary.accounts.filter(isRecord).map((account) => ({
    id: typeof account.id === 'string' ? account.id : '',
    type: account.type === 'CHECKING' || account.type === 'SAVINGS' ? account.type : null,
    name: typeof account.name === 'string' ? account.name : 'Account',
    bankName: typeof account.bankName === 'string' ? account.bankName : null,
    owner: null,
    accountNumber: typeof account.accountNumber === 'string' ? account.accountNumber : null,
    balance: typeof account.balance === 'number' ? account.balance : null,
    currency: typeof account.currency === 'string' ? account.currency : null,
  }));
}

function visibleAccounts(
  accounts: PersonaAccountSummary[],
  selected: string[] | undefined,
): PersonaAccountSummary[] {
  return selected === undefined
    ? accounts
    : accounts.filter((account) => selected.includes(account.id));
}
