import { Logger } from '@nestjs/common';
import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import { isUUID } from 'class-validator';
import type { ObjectStoragePort } from '../../../../storage/object-storage.port';
import type {
  ConnectorSettingsService,
  ResolvedConnectorSettings,
} from '../../../connector-settings.service';
import { ConnectorCallbackAlreadyAppliedError } from '../../../errors/connector-callback-already-applied.error';
import { CreditProviderCredentialsRejectedException } from '../../../errors/credit-provider-credentials-rejected.exception';
import { CreditProviderRejectedException } from '../../../errors/credit-provider-rejected.exception';
import { PendingConnectorReconcileUnsupportedException } from '../../../errors/pending-connector-reconcile-unsupported.exception';
import type {
  ConnectorAdapter,
  ConnectorCallbackAuth,
  ConnectorCallbackMappingInput,
  ConnectorExecutionInput,
  ConnectorReconcileInput,
  ConnectorReconcileResult,
  ConnectorSettingsSchema,
} from '../../../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
  type ConnectorCallbackResult,
} from '../../../ports/connector-execution-result';
import type {
  AwaitingCallbackConnectorResolution,
  AwaitingCallbackConnectorResolver,
} from '../../../resolvers/awaiting-callback-connector.resolver';
import type { CompletedOnboardingDocumentResolver } from '../../../resolvers/completed-onboarding-document.resolver';
import { buildParkedCallbackResult } from '../shared/parked-callback-result';
import { parseCreditConfig } from './credit-config';
import {
  CREDIT_ATTEMPT_COUNT_FIELD,
  CREDIT_BANK_DATA_FIELD,
  CREDIT_BANK_DATA_INVALID_ERROR,
  CREDIT_INDICATORS_FIELD,
  CREDIT_NO_ACCOUNTS_SELECTED_ERROR,
  CREDIT_OUTCOME_FIELD,
  CREDIT_PROVIDER_REFERENCE_FIELD,
  CREDIT_REASON_CODES_FIELD,
  CREDIT_REPORT_FIELD,
  CREDIT_SCORE_BAND_FIELD,
  CREDIT_SCORE_FIELD,
  CREDIT_SECONDARY_SCORES_FIELD,
  type CreditCallbackSubmission,
} from './credit-contract';
import { buildCreditSubmittedData, evaluateCreditOutcome } from './credit-outcome';
import {
  CreditBankDataInvalidError,
  CreditPendingReferenceMalformedError,
  CreditProviderCredentialsRejectedError,
  CreditProviderRejectedError,
  type CreditCallbackEvent,
  type CreditPendingReference,
  type CreditProvider,
} from './credit-provider.port';
import { buildCreditSubmission, CreditNoAccountsSelectedError } from './credit-submission';

const CREDIT_CALLBACK_FIELDS = [
  CREDIT_OUTCOME_FIELD,
  CREDIT_SCORE_FIELD,
  CREDIT_SCORE_BAND_FIELD,
  CREDIT_INDICATORS_FIELD,
  CREDIT_SECONDARY_SCORES_FIELD,
  CREDIT_REASON_CODES_FIELD,
  CREDIT_ATTEMPT_COUNT_FIELD,
  CREDIT_PROVIDER_REFERENCE_FIELD,
  CREDIT_REPORT_FIELD,
] as const;

/**
 * The engine-facing half of every credit assessment connector: parsing the step's config, reading
 * the `bankData` document before any provider call, correlating a callback to the onboarding
 * awaiting it, and turning a provider result into the step's outcome. The wire half is the
 * `CreditProvider` it is built with. Every outcome is `accepted()`: the connector never chooses
 * the next step, the workflow document routes on `creditOutcome`.
 */
export abstract class CreditConnector<
  TEvent extends CreditCallbackEvent = CreditCallbackEvent,
> implements ConnectorAdapter {
  private readonly logger = new Logger(CreditConnector.name);

  readonly id: string;
  readonly name: string;
  readonly type = 'credit' as const;
  readonly supportsAsyncCallback = true;
  readonly callbackAuth: ConnectorCallbackAuth;
  readonly settingsSchema: ConnectorSettingsSchema;
  readonly callbackFields: readonly string[] = CREDIT_CALLBACK_FIELDS;
  /** The report is provider-shaped and large; the audit row records its size instead. */
  readonly auditRedactedFields: readonly string[] = [CREDIT_REPORT_FIELD];

  constructor(
    private readonly provider: CreditProvider<TEvent>,
    private readonly connectorSettingsService: ConnectorSettingsService,
    private readonly documentResolver: CompletedOnboardingDocumentResolver,
    private readonly objectStoragePort: ObjectStoragePort,
    private readonly awaitingCallbackConnectorResolver: AwaitingCallbackConnectorResolver,
  ) {
    this.id = provider.id;
    this.name = provider.name;
    this.callbackAuth = provider.callbackAuth;
    this.settingsSchema = provider.settingsSchema;
  }

  validateDeclaration(declaration: NormalizedWorkflowConnectorDeclaration): void {
    const config = parseCreditConfig(this.id, declaration.config);

    this.provider.validateConfig(config.providerConfig, config);
  }

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const config = parseCreditConfig(this.id, input.declaration.config);
    const settings = await this.connectorSettingsService.resolve(this);

    try {
      const submission = await buildCreditSubmission(
        this.id,
        input,
        this.nextAttempt(input.context),
        this.documentResolver,
        this.objectStoragePort,
      );

      if (!submission) {
        return ConnectorExecutionResult.invalid();
      }

      this.provider.validateBankData(submission.bankData, config);

      const receipt = await this.provider.startAssessment(settings, submission, config);

      // The executor copies the reference into the persisted pending connector.
      return ConnectorExecutionResult.accepted({ providerReference: receipt.providerReference });
    } catch (error: unknown) {
      if (error instanceof CreditBankDataInvalidError) {
        // The client's to fix: the step stays, the field names the document to upload again.
        this.logger.log(
          `CREDIT_BANK_DATA_INVALID connectorId=${this.id} ` +
            `onboardingId=${input.execution.onboardingId}`,
        );

        return ConnectorExecutionResult.invalidData(
          { [CREDIT_BANK_DATA_FIELD]: [CREDIT_BANK_DATA_INVALID_ERROR] },
          { [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true },
        );
      }

      // No provider call was made: the selection kept no account. The error sits on the field the
      // selection came from, since the document itself is sound.
      if (error instanceof CreditNoAccountsSelectedError) {
        this.logger.log(
          `CREDIT_NO_ACCOUNTS_SELECTED connectorId=${this.id} ` +
            `onboardingId=${input.execution.onboardingId}`,
        );

        return ConnectorExecutionResult.invalidData(
          { [error.sourceField]: [CREDIT_NO_ACCOUNTS_SELECTED_ERROR] },
          { [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true },
        );
      }

      // An operator's to fix in the connector settings; the line names the connector, never a secret.
      if (error instanceof CreditProviderCredentialsRejectedError) {
        this.logger.error(`CREDIT_PROVIDER_CREDENTIALS_REJECTED connectorId=${this.id}`);

        throw new CreditProviderCredentialsRejectedException(this.id);
      }

      if (error instanceof CreditProviderRejectedError) {
        this.logger.warn(
          `CREDIT_PROVIDER_REJECTED connectorId=${this.id} ` +
            `onboardingId=${input.execution.onboardingId} status=${error.providerStatus} ` +
            `code=${error.providerCode ?? 'none'}`,
        );

        throw new CreditProviderRejectedException(
          this.id,
          error.providerStatus,
          error.providerCode,
        );
      }

      throw error;
    }
  }

  /**
   * Correlates the callback to an onboarding still awaiting it, re-parks an event that decides
   * nothing or names an attempt the park no longer waits on, and otherwise reads the result back
   * from the provider (never trusting the webhook body for it) and decides.
   */
  async mapCallbackResult(input: ConnectorCallbackMappingInput): Promise<ConnectorCallbackResult> {
    const settings = await this.connectorSettingsService.resolve(this);
    const event = await this.provider.parseCallback(input, settings);

    if (!isUUID(event.onboardingId)) {
      throw new ConnectorCallbackAlreadyAppliedError(event.onboardingId, this.id);
    }

    const resolvedConnector = await this.awaitingCallbackConnectorResolver.findConnector({
      onboardingId: event.onboardingId,
      connectorId: this.id,
    });

    if (!resolvedConnector) {
      throw new ConnectorCallbackAlreadyAppliedError(event.onboardingId, this.id);
    }

    if (!event.actionable) {
      this.logger.debug(
        `CREDIT_CALLBACK_ACKNOWLEDGED connectorId=${this.id} onboardingId=${event.onboardingId}`,
      );

      return buildParkedCallbackResult(this, event.onboardingId, resolvedConnector);
    }

    // A late result for an attempt a retry has since superseded must not decide the onboarding.
    const parkedReference = resolvedConnector.pendingConnector?.providerReference;

    if (
      parkedReference !== undefined &&
      event.providerReference !== undefined &&
      event.providerReference !== parkedReference
    ) {
      this.logger.log(
        `CREDIT_CALLBACK_SUPERSEDED connectorId=${this.id} onboardingId=${event.onboardingId}`,
      );

      return buildParkedCallbackResult(this, event.onboardingId, resolvedConnector);
    }

    return this.decide(event, resolvedConnector, settings);
  }

  /**
   * Reads the parked attempt's result back from the provider for an operator whose callback never
   * came: the same correlation and decision as a callback, minus the parse.
   */
  async reconcilePending(input: ConnectorReconcileInput): Promise<ConnectorReconcileResult> {
    const resolvedConnector = await this.awaitingCallbackConnectorResolver.findConnector({
      onboardingId: input.onboardingId,
      connectorId: this.id,
    });

    if (!resolvedConnector) {
      throw new ConnectorCallbackAlreadyAppliedError(input.onboardingId, this.id);
    }

    const providerReference = resolvedConnector.pendingConnector.providerReference;

    if (providerReference === undefined) {
      throw new PendingConnectorReconcileUnsupportedException(this.id, 'reference_missing');
    }

    const settings = await this.connectorSettingsService.resolve(this);
    const callback = await this.decideParked(
      { onboardingId: input.onboardingId, providerReference },
      resolvedConnector,
      settings,
    );
    const outcome = callback.result.isPending() ? 'still_pending' : 'resolved';

    this.logger.log(
      `CREDIT_RECONCILE connectorId=${this.id} onboardingId=${input.onboardingId} outcome=${outcome}`,
    );

    return outcome === 'still_pending' ? { outcome } : { outcome, callback };
  }

  /**
   * The reconcile's read: the provider builds the event from the park and reads with it. A
   * reference the provider cannot read is the operator's 409, not a 500.
   */
  private async decideParked(
    reference: CreditPendingReference,
    resolvedConnector: AwaitingCallbackConnectorResolution,
    settings: ResolvedConnectorSettings,
  ): Promise<ConnectorCallbackResult> {
    try {
      const event = this.provider.buildReconcileEvent(reference);

      return await this.decide(event, resolvedConnector, settings);
    } catch (error: unknown) {
      if (error instanceof CreditPendingReferenceMalformedError) {
        throw new PendingConnectorReconcileUnsupportedException(this.id, 'reference_malformed');
      }

      throw error;
    }
  }

  /** Reads the result the provider holds and turns it into the step's outcome, or re-parks. */
  private async decide(
    event: TEvent,
    resolvedConnector: AwaitingCallbackConnectorResolution,
    settings: ResolvedConnectorSettings,
  ): Promise<ConnectorCallbackResult> {
    const config = parseCreditConfig(this.id, resolvedConnector.connector.config);
    const onboardingContext = resolvedConnector.onboarding.context;
    const result = await this.provider.fetchResult(settings, event, {
      config,
      providerConfig: config.providerConfig,
      onboardingContext,
    });

    if (result.status === 'pending') {
      return buildParkedCallbackResult(this, event.onboardingId, resolvedConnector);
    }

    // The context holds the count the previous callback wrote, so the attempt being decided is
    // the next one — the same number `execute` handed the provider.
    const attemptCount = this.nextAttempt(onboardingContext);
    const evaluation = evaluateCreditOutcome(result, config, attemptCount);
    const providerReference =
      resolvedConnector.pendingConnector.providerReference ?? event.providerReference ?? '';

    this.logger.log(
      `CREDIT_DECIDED connectorId=${this.id} onboardingId=${event.onboardingId} ` +
        `outcome=${evaluation.outcome} attempts=${attemptCount} maxAttempts=${config.maxAttempts}`,
    );

    const submittedData: CreditCallbackSubmission = buildCreditSubmittedData({
      result,
      evaluation,
      config,
      attemptCount,
      providerReference,
    });

    return {
      onboardingId: event.onboardingId,
      submittedData,
      resolvedConnector,
      result: ConnectorExecutionResult.accepted(),
    };
  }

  private nextAttempt(context: Readonly<Record<string, unknown>>): number {
    const previous = context[CREDIT_ATTEMPT_COUNT_FIELD];

    return (typeof previous === 'number' ? previous : 0) + 1;
  }
}
