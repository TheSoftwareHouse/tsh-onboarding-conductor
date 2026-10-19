import { Injectable, Logger } from '@nestjs/common';
import type { NormalizedWorkflowConnectorFallback } from '@tsh/ddl-schema';
import { isUUID } from 'class-validator';
import type { ResolvedConnectorSettings } from '../../../connector-settings.service';
import { ConnectorSettingsService } from '../../../connector-settings.service';
import { ConnectorCallbackAlreadyAppliedError } from '../../../errors/connector-callback-already-applied.error';
import { LeanUnavailableException } from '../../../errors/lean-unavailable.exception';
import { PendingConnectorReconcileUnsupportedException } from '../../../errors/pending-connector-reconcile-unsupported.exception';
import type {
  ConnectorAdapter,
  ConnectorCallbackHmacAuth,
  ConnectorCallbackMappingInput,
  ConnectorExecutionInput,
  ConnectorReconcileInput,
  ConnectorReconcileResult,
} from '../../../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
  type ConnectorCallbackResult,
} from '../../../ports/connector-execution-result';
import {
  AwaitingCallbackConnectorResolver,
  type AwaitingCallbackConnectorResolution,
} from '../../../resolvers/awaiting-callback-connector.resolver';
import {
  buildLeanInsightsStartDate,
  isLeanDataUsable,
  mapLeanInsights,
  parseLeanCallback,
  parseLeanSignatureHeader,
} from './lean-bank-data-callback';
import { LeanClient } from './lean-client';
import { LEAN_BANK_DATA_SETTINGS } from './lean-config';
import {
  LEAN_BANK_CONNECT_OUTCOME_DATA_UNAVAILABLE,
  LEAN_BANK_CONNECT_OUTCOME_NOT_CONNECTED,
  LEAN_BANK_DATA_CONNECTOR_ID,
  LEAN_CONNECT_ABANDONED_AFTER_MS,
  LEAN_ERROR_STATUS_UNKNOWN_CUSTOMER,
  LEAN_FIELD_BANK_CONNECT_OUTCOME,
  LEAN_CONFIG_MIN_MONTHLY_SALARY,
  LEAN_FIELD_EMPLOYER_NAME,
  LEAN_FIELD_LEAN_CUSTOMER_ID,
  LEAN_FIELD_NON_SALARY_MONTHLY_AVERAGE,
  LEAN_FIELD_SALARY_CONSISTENT,
  LEAN_FIELD_SALARY_MONTHLY_AVERAGE,
  LEAN_FIELD_SALARY_MONTHS_DETECTED,
  LEAN_FIELD_SALARY_THRESHOLD_MET,
  LEAN_HTTP_STATUS_NOT_FOUND,
  type LeanBankDataCallbackFields,
  type LeanCredentials,
  type LeanCustomer,
} from './lean-contract';

/** The "no onboarding" an unrelated or unreadable callback is acknowledged against. */
const UNCORRELATED_CALLBACK = 'unknown';

const INVALID_CUSTOMER_ERROR = 'invalid_lean_customer';

/** A refusal the applicant can correct by submitting another customer id on the same step. */
const RETRYABLE_INVALID_DATA_METADATA = {
  [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
};

/**
 * The workflow's salary threshold from the declaration's `config`. It is read on every callback
 * and reconcile too, from the declaration the park resolves to, so a config edited into something
 * unusable fails loudly rather than deciding against a guess.
 */
const getMinMonthlySalary = (
  connectorId: string,
  config: Readonly<Record<string, unknown>>,
): number => {
  const value = config[LEAN_CONFIG_MIN_MONTHLY_SALARY];

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `config.${LEAN_CONFIG_MIN_MONTHLY_SALARY} must be a finite number greater than 0 for connector id=${connectorId}`,
    );
  }

  return value;
};

/** Every key a callback may put in `submittedData`; the `bank_connect` step declares them all. */
const CALLBACK_FIELDS: readonly string[] = [
  LEAN_FIELD_BANK_CONNECT_OUTCOME,
  LEAN_FIELD_SALARY_MONTHLY_AVERAGE,
  LEAN_FIELD_SALARY_MONTHS_DETECTED,
  LEAN_FIELD_NON_SALARY_MONTHLY_AVERAGE,
  LEAN_FIELD_SALARY_CONSISTENT,
  LEAN_FIELD_EMPLOYER_NAME,
  LEAN_FIELD_SALARY_THRESHOLD_MET,
];

/**
 * The outcome of reading income and employment: a verdict to apply, Lean not done yet, or Lean
 * unable to answer synchronously for this bank at all.
 */
type LeanInsightsOutcome =
  | Readonly<{ kind: 'decided'; fields: LeanBankDataCallbackFields }>
  | Readonly<{ kind: 'pending' }>
  | Readonly<{ kind: 'unsupported' }>;

/**
 * Open-banking data through Lean's LinkSDK, as an async callback connector. The applicant links a
 * bank in a widget the host service runs; the engine parks the step on the Lean customer id
 * (`providerReference`) and Lean's signed webhooks drive it: `entity.created` and a `PENDING`
 * refresh only re-park, a `FINISHED` refresh pulls income and employment insights and emits the
 * callback fields the workflow routes on. Correlation is Lean's echo of `app_user_id`, which the
 * host service sets to the onboarding id, checked again here so a client cannot bind another
 * onboarding's customer.
 */
@Injectable()
export class LeanBankDataConnector implements ConnectorAdapter {
  private readonly logger = new Logger(LeanBankDataConnector.name);

  readonly name = LEAN_BANK_DATA_CONNECTOR_ID;
  readonly id = LEAN_BANK_DATA_CONNECTOR_ID;
  readonly type = 'credit' as const;
  readonly supportsAsyncCallback = true;
  readonly callbackAuth: ConnectorCallbackHmacAuth = {
    kind: 'hmac',
    algorithm: 'sha512',
    signatureHeader: 'lean-signature',
    encoding: 'hex',
    parseSignatureHeader: parseLeanSignatureHeader,
  };
  readonly callbackFields = CALLBACK_FIELDS;
  readonly settingsSchema = LEAN_BANK_DATA_SETTINGS;

  constructor(
    private readonly leanClient: LeanClient,
    private readonly connectorSettingsService: ConnectorSettingsService,
    private readonly awaitingCallbackConnectorResolver: AwaitingCallbackConnectorResolver,
  ) {}

  validateDeclaration(declaration: NormalizedWorkflowConnectorFallback): void {
    getMinMonthlySalary(this.id, declaration.config);
  }

  /**
   * Accepts only a Lean customer created for this very onboarding; the executor parks the step
   * because the declaration is `async`, recording the customer id as the park's reference.
   */
  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const customerId = input.payload[LEAN_FIELD_LEAN_CUSTOMER_ID];
    const errorField =
      input.payloadFieldSources[LEAN_FIELD_LEAN_CUSTOMER_ID] ?? LEAN_FIELD_LEAN_CUSTOMER_ID;

    // Lean customer ids are UUIDs; anything else would only earn a 4xx from Lean, which reads as
    // an integration failure rather than the client's mistake it is.
    if (typeof customerId !== 'string' || !isUUID(customerId)) {
      return ConnectorExecutionResult.invalidData(
        { [errorField]: [INVALID_CUSTOMER_ERROR] },
        RETRYABLE_INVALID_DATA_METADATA,
      );
    }

    const credentials = this.resolveCredentials(await this.connectorSettingsService.resolve(this));
    const customer = await this.findCustomer(credentials, customerId);

    if (customer === undefined || customer.app_user_id !== input.execution.onboardingId) {
      return ConnectorExecutionResult.invalidData(
        { [errorField]: [INVALID_CUSTOMER_ERROR] },
        RETRYABLE_INVALID_DATA_METADATA,
      );
    }

    return ConnectorExecutionResult.accepted({ providerReference: customer.customer_id });
  }

  /**
   * Correlates a Lean webhook to the onboarding parked on its customer. Events that decide nothing
   * re-park; a finished refresh reads the insights back from Lean (never trusting the webhook body
   * for them) and decides, or re-parks while Lean cannot answer yet.
   */
  async mapCallbackResult(input: ConnectorCallbackMappingInput): Promise<ConnectorCallbackResult> {
    const event = parseLeanCallback(input.rawBody);

    if (event === undefined) {
      throw new ConnectorCallbackAlreadyAppliedError(UNCORRELATED_CALLBACK, this.id);
    }

    const credentials = this.resolveCredentials(await this.connectorSettingsService.resolve(this));
    const onboardingId =
      event.kind === 'entity'
        ? event.appUserId
        : (await this.findCustomer(credentials, event.customerId))?.app_user_id;

    // Lean echoes whatever `app_user_id` it was given; only a UUID can match an onboarding.
    if (onboardingId === undefined || !isUUID(onboardingId)) {
      throw new ConnectorCallbackAlreadyAppliedError(
        onboardingId ?? UNCORRELATED_CALLBACK,
        this.id,
      );
    }

    const resolvedConnector = await this.awaitingCallbackConnectorResolver.findConnector({
      onboardingId,
      connectorId: this.id,
    });

    if (!resolvedConnector) {
      throw new ConnectorCallbackAlreadyAppliedError(onboardingId, this.id);
    }

    // A webhook for another customer than the one this park waits on belongs to an earlier
    // attempt; it must not decide this one.
    const parkedReference = resolvedConnector.pendingConnector.providerReference;

    if (parkedReference !== undefined && event.customerId !== parkedReference) {
      this.logger.log(
        `LEAN_CALLBACK_SUPERSEDED connectorId=${this.id} onboardingId=${onboardingId}`,
      );

      return this.buildParkedResult(onboardingId, resolvedConnector);
    }

    if (event.kind === 'entity' || !event.finished) {
      this.logger.debug(
        `LEAN_CALLBACK_ACKNOWLEDGED connectorId=${this.id} onboardingId=${onboardingId}`,
      );

      return this.buildParkedResult(onboardingId, resolvedConnector);
    }

    if (!isLeanDataUsable(event.dataStatus)) {
      this.logger.log(`LEAN_DATA_UNAVAILABLE connectorId=${this.id} onboardingId=${onboardingId}`);

      return this.buildOutcomeResult(onboardingId, resolvedConnector, {
        bankConnectOutcome: LEAN_BANK_CONNECT_OUTCOME_DATA_UNAVAILABLE,
      });
    }

    const insights = await this.pullInsights(
      credentials,
      event.entityId,
      onboardingId,
      getMinMonthlySalary(this.id, resolvedConnector.connector.config),
    );

    // A webhook cannot settle an unsupported read; the park stays for the operator's reconcile.
    return insights.kind === 'decided'
      ? this.buildOutcomeResult(onboardingId, resolvedConnector, insights.fields)
      : this.buildParkedResult(onboardingId, resolvedConnector);
  }

  /**
   * Reads the connect's result back from Lean for an operator whose webhook never came: no entity
   * yet is still pending until the park is old enough to call the connect abandoned; an entity
   * goes through the same insights read a finished refresh does.
   */
  async reconcilePending(input: ConnectorReconcileInput): Promise<ConnectorReconcileResult> {
    const resolvedConnector = await this.awaitingCallbackConnectorResolver.findConnector({
      onboardingId: input.onboardingId,
      connectorId: this.id,
    });

    if (!resolvedConnector) {
      throw new ConnectorCallbackAlreadyAppliedError(input.onboardingId, this.id);
    }

    const customerId = resolvedConnector.pendingConnector.providerReference;

    if (customerId === undefined) {
      throw new PendingConnectorReconcileUnsupportedException(this.id, 'reference_missing');
    }

    const credentials = this.resolveCredentials(await this.connectorSettingsService.resolve(this));
    const entities = await this.leanClient.listCustomerEntities(credentials, customerId);

    // A listing Lean refuses says nothing about the connect, so nothing is decided on it.
    if (entities.kind !== 'ok') {
      return { outcome: 'still_pending' };
    }

    const [latestEntity] = [...entities.body].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );

    if (latestEntity === undefined) {
      if (!this.isAbandoned(resolvedConnector.pendingConnector.parkedAt)) {
        return { outcome: 'still_pending' };
      }

      return this.buildResolved(input.onboardingId, resolvedConnector, {
        bankConnectOutcome: LEAN_BANK_CONNECT_OUTCOME_NOT_CONNECTED,
      });
    }

    const insights = await this.pullInsights(
      credentials,
      latestEntity.id,
      input.onboardingId,
      getMinMonthlySalary(this.id, resolvedConnector.connector.config),
    );

    if (insights.kind === 'pending') {
      return { outcome: 'still_pending' };
    }

    // Repeating a synchronous read Lean answered 501 to never changes the answer, so reconcile
    // ends the park rather than keeping it forever.
    return this.buildResolved(
      input.onboardingId,
      resolvedConnector,
      insights.kind === 'unsupported'
        ? { bankConnectOutcome: LEAN_BANK_CONNECT_OUTCOME_DATA_UNAVAILABLE }
        : insights.fields,
    );
  }

  private resolveCredentials(settings: ResolvedConnectorSettings): LeanCredentials {
    return { clientId: settings.get('clientId'), clientSecret: settings.get('clientSecret') };
  }

  /**
   * Only Lean's `404 UNKNOWN_CUSTOMER` means there is no such customer. Any other refusal (forbidden,
   * rate limited, a repeated `401`) says nothing about the customer, so it is an integration failure
   * rather than a customer that does not exist.
   */
  private async findCustomer(
    credentials: LeanCredentials,
    customerId: string,
  ): Promise<LeanCustomer | undefined> {
    const customer = await this.leanClient.getCustomer(credentials, customerId);

    if (customer.kind === 'ok') {
      return customer.body;
    }

    if (
      customer.httpStatus === LEAN_HTTP_STATUS_NOT_FOUND &&
      customer.body.status === LEAN_ERROR_STATUS_UNKNOWN_CUSTOMER
    ) {
      return undefined;
    }

    this.logger.warn(
      `LEAN_CUSTOMER_LOOKUP_ERROR connectorId=${this.id} httpStatus=${customer.httpStatus} ` +
        `status=${customer.body.status}`,
    );
    throw new LeanUnavailableException();
  }

  /**
   * Income and employment for one entity. Still computing is `pending` and unsupported
   * synchronously is `unsupported`; the caller decides what each means. A refused request (the data
   * cannot be had) is `data_unavailable`, which the workflow routes to review.
   */
  private async pullInsights(
    credentials: LeanCredentials,
    entityId: string,
    onboardingId: string,
    minMonthlySalary: number,
  ): Promise<LeanInsightsOutcome> {
    const request = { entityId, startDate: buildLeanInsightsStartDate(new Date()) };
    const income = await this.leanClient.getIncome(credentials, request);

    if (income.kind === 'pending' || income.kind === 'unsupported') {
      return { kind: income.kind };
    }

    const employment =
      income.kind === 'ok' ? await this.leanClient.getEmployment(credentials, request) : undefined;

    if (employment?.kind === 'pending' || employment?.kind === 'unsupported') {
      return { kind: employment.kind };
    }

    if (income.kind === 'ok' && employment?.kind === 'ok') {
      return {
        kind: 'decided',
        fields: mapLeanInsights(income.body, employment.body, minMonthlySalary),
      };
    }

    this.logger.log(
      `LEAN_INSIGHTS_REFUSED connectorId=${this.id} onboardingId=${onboardingId} ` +
        `incomeStatus=${income.kind === 'error' ? income.body.status : income.kind} ` +
        `employmentStatus=${employment?.kind === 'error' ? employment.body.status : 'skipped'}`,
    );

    return {
      kind: 'decided',
      fields: { bankConnectOutcome: LEAN_BANK_CONNECT_OUTCOME_DATA_UNAVAILABLE },
    };
  }

  private isAbandoned(parkedAt: string | undefined): boolean {
    // A park recorded before `parkedAt` existed cannot be shown to be old.
    return (
      parkedAt !== undefined && Date.now() - Date.parse(parkedAt) >= LEAN_CONNECT_ABANDONED_AFTER_MS
    );
  }

  /** Re-parks the step with no decision applied, keeping the stored reference and park time. */
  private buildParkedResult(
    onboardingId: string,
    resolvedConnector: AwaitingCallbackConnectorResolution,
  ): ConnectorCallbackResult {
    return {
      onboardingId,
      submittedData: {},
      resolvedConnector,
      result: ConnectorExecutionResult.pending({
        ...resolvedConnector.pendingConnector,
        connectorName: this.name,
        connectorId: this.id,
        connectorOrder: resolvedConnector.connectorOrder,
      }),
    };
  }

  private buildOutcomeResult(
    onboardingId: string,
    resolvedConnector: AwaitingCallbackConnectorResolution,
    submittedData: LeanBankDataCallbackFields,
  ): ConnectorCallbackResult {
    return {
      onboardingId,
      submittedData,
      resolvedConnector,
      result: ConnectorExecutionResult.accepted(),
    };
  }

  private buildResolved(
    onboardingId: string,
    resolvedConnector: AwaitingCallbackConnectorResolution,
    submittedData: LeanBankDataCallbackFields,
  ): ConnectorReconcileResult {
    return {
      outcome: 'resolved',
      callback: this.buildOutcomeResult(onboardingId, resolvedConnector, submittedData),
    };
  }
}
