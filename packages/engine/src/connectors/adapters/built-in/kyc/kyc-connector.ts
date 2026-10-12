import { Logger } from '@nestjs/common';
import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import { isUUID } from 'class-validator';
import type { ObjectStoragePort } from '../../../../storage/object-storage.port';
import type {
  ConnectorSettingsService,
  ResolvedConnectorSettings,
} from '../../../connector-settings.service';
import { ConnectorCallbackAlreadyAppliedError } from '../../../errors/connector-callback-already-applied.error';
import { ConnectorPayloadFieldNotFoundError } from '../../../errors/connector-payload-field-not-found.error';
import { PendingConnectorReconcileUnsupportedException } from '../../../errors/pending-connector-reconcile-unsupported.exception';
import type {
  ConnectorAdapter,
  ConnectorCallbackHmacAuth,
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
import {
  KYC_ATTEMPT_COUNT_FIELD,
  KYC_CUSTOMER_MESSAGE_FIELD,
  KYC_DOCUMENT_UNSUPPORTED_ERROR,
  KYC_OUTCOME_FIELD,
  KYC_REASON_CODES_FIELD,
  KYC_RETRY_STEP_FIELD,
  type KycCallbackSubmission,
} from './kyc-contract';
import { KycConfigInvalidError, parseKycConfig } from './kyc-config';
import { compareDeclaredIdentity, type KycIdentityComparison } from './kyc-identity-comparison';
import {
  buildKycSubmittedData,
  evaluateKycOutcome,
  type KycAppliedEvaluation,
} from './kyc-outcome';
import {
  type KycCallbackEvent,
  KycDocumentUnsupportedError,
  type KycProvider,
  type KycVerifiedIdentity,
} from './kyc-provider.port';
import { buildKycApplicant, buildKycSubmission } from './kyc-submission';

const NO_VERIFIED_DATA: KycIdentityComparison = { result: 'no-verified-data', divergedFields: [] };

/**
 * The engine-facing half of every KYC connector: parsing the step's derived config, resolving and
 * reading every captured document before any provider call, correlating a callback to the
 * onboarding awaiting it, and turning a provider verdict into the outcome contract of ADR 0005.
 * The wire half — HTTP, signing, the provider's own states — is the `KycProvider` it is built
 * with. Every outcome the callback reports is `accepted()`: the connector never chooses the next
 * step, the workflow document routes on `kycOutcome`.
 */
export abstract class KycConnector<
  TEvent extends KycCallbackEvent = KycCallbackEvent,
> implements ConnectorAdapter {
  private readonly logger = new Logger(KycConnector.name);

  readonly id: string;
  readonly name: string;
  readonly type = 'kyc' as const;
  readonly supportsAsyncCallback = true;
  readonly callbackAuth: ConnectorCallbackHmacAuth;
  readonly settingsSchema: ConnectorSettingsSchema;
  /** Every `submittedData` key a callback may carry; a step bound to this connector declares them all. */
  readonly callbackFields: readonly string[];

  constructor(
    private readonly provider: KycProvider<TEvent>,
    private readonly connectorSettingsService: ConnectorSettingsService,
    private readonly documentResolver: CompletedOnboardingDocumentResolver,
    private readonly objectStoragePort: ObjectStoragePort,
    private readonly awaitingCallbackConnectorResolver: AwaitingCallbackConnectorResolver,
  ) {
    this.id = provider.id;
    this.name = provider.name;
    this.callbackAuth = provider.callbackAuth;
    this.settingsSchema = provider.settingsSchema;
    this.callbackFields = [
      KYC_OUTCOME_FIELD,
      KYC_RETRY_STEP_FIELD,
      KYC_REASON_CODES_FIELD,
      KYC_CUSTOMER_MESSAGE_FIELD,
      ...(provider.countsAttempts ? [] : [KYC_ATTEMPT_COUNT_FIELD]),
    ];
  }

  validateDeclaration(declaration: NormalizedWorkflowConnectorDeclaration): void {
    const config = parseKycConfig(this.id, declaration.config);

    const mappedKeys = {
      ...declaration.fieldMapping,
      ...declaration.optionalFieldMapping,
    };

    for (const document of config.documents) {
      for (const payloadKey of [document.payloadField, document.countryField]) {
        if (payloadKey !== undefined && !(payloadKey in mappedKeys)) {
          throw new KycConfigInvalidError(
            this.id,
            'documents',
            `references payload key "${payloadKey}" that is missing from fieldMapping`,
          );
        }
      }
    }

    this.provider.validateConfig(config.providerConfig, config);
  }

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const config = parseKycConfig(this.id, input.declaration.config);
    const settings = await this.connectorSettingsService.resolve(this);

    const submission = await buildKycSubmission(
      this.id,
      config,
      input,
      this.documentResolver,
      this.objectStoragePort,
    );

    if (!submission) {
      return ConnectorExecutionResult.invalid();
    }

    try {
      const receipt = await this.provider.submit(settings, submission);

      // The executor copies the reference into the persisted pending connector.
      return ConnectorExecutionResult.accepted({ providerReference: receipt.providerReference });
    } catch (error: unknown) {
      if (!(error instanceof KycDocumentUnsupportedError)) {
        throw error;
      }

      // The client's to fix: the step stays, the field names the document to upload again.
      this.logger.log(
        `KYC_DOCUMENT_UNSUPPORTED connectorId=${this.id} ` +
          `onboardingId=${input.execution.onboardingId} field=${error.document.sourceField} ` +
          `contentType=${error.document.contentType}`,
      );

      return ConnectorExecutionResult.invalidData(
        { [error.document.sourceField]: [KYC_DOCUMENT_UNSUPPORTED_ERROR] },
        { [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true },
      );
    }
  }

  /**
   * Correlates the callback to an onboarding still awaiting it, re-parks an event that decides
   * nothing, and otherwise reads back the verdict the provider actually holds (never trusting the
   * webhook body for it) and decides through `evaluateKycOutcome`.
   */
  async mapCallbackResult(input: ConnectorCallbackMappingInput): Promise<ConnectorCallbackResult> {
    const settings = await this.connectorSettingsService.resolve(this);
    const event = await this.provider.parseCallback(input, settings);

    // The provider echoes whatever id it was given; a value that is not a UUID can match no
    // onboarding and must not reach a UUID column as a cast error.
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
        `KYC_CALLBACK_ACKNOWLEDGED connectorId=${this.id} onboardingId=${event.onboardingId}`,
      );

      return this.buildParkedResult(event.onboardingId, resolvedConnector);
    }

    // A late decision for a session the operator's provider switch (or a retry) has since
    // superseded must not decide the onboarding. Sumsub's reference is its stable applicant id,
    // so the guard never fires for it.
    const parkedReference = resolvedConnector.pendingConnector?.providerReference;

    if (
      parkedReference !== undefined &&
      event.providerReference !== undefined &&
      event.providerReference !== parkedReference
    ) {
      this.logger.log(
        `KYC_CALLBACK_SUPERSEDED connectorId=${this.id} onboardingId=${event.onboardingId}`,
      );

      return this.buildParkedResult(event.onboardingId, resolvedConnector);
    }

    return this.decide(event, resolvedConnector, settings);
  }

  /**
   * Reads the parked attempt's verdict back from the provider for an operator whose callback
   * never came. The same correlation and decision as a callback, minus the parse: a provider
   * still undecided is `still_pending`, a resolved one is the callback the webhook would have
   * carried, applied by the caller through the same submit path.
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
    const event = this.provider.buildReconcileEvent({
      onboardingId: input.onboardingId,
      providerReference,
    });
    const callback = await this.decide(event, resolvedConnector, settings);
    const outcome = callback.result.isPending() ? 'still_pending' : 'resolved';

    this.logger.log(
      `KYC_RECONCILE connectorId=${this.id} onboardingId=${input.onboardingId} outcome=${outcome}`,
    );

    return outcome === 'still_pending' ? { outcome } : { outcome, callback };
  }

  /** Reads the verdict the provider holds and turns it into the step's outcome, or re-parks. */
  private async decide(
    event: TEvent,
    resolvedConnector: AwaitingCallbackConnectorResolution,
    settings: ResolvedConnectorSettings,
  ): Promise<ConnectorCallbackResult> {
    const config = parseKycConfig(this.id, resolvedConnector.connector.config);
    const onboardingContext = resolvedConnector.onboarding.context;
    const verdict = await this.provider.fetchVerdict(settings, event, {
      config,
      providerConfig: config.providerConfig,
      onboardingContext,
    });

    const previousAttemptCount = onboardingContext[KYC_ATTEMPT_COUNT_FIELD];
    const evaluation = evaluateKycOutcome(verdict, {
      identityComparison:
        verdict.kind === 'approved'
          ? this.compareIdentity(verdict.verifiedIdentity, resolvedConnector)
          : NO_VERIFIED_DATA,
      previousAttemptCount: typeof previousAttemptCount === 'number' ? previousAttemptCount : 0,
      maxAttemptsPerDocSet: config.maxAttemptsPerDocSet,
      providerCountsAttempts: this.provider.countsAttempts,
    });

    if (evaluation.action === 'park') {
      return this.buildParkedResult(event.onboardingId, resolvedConnector);
    }

    const { decision } = evaluation;

    this.logDecision(event.onboardingId, decision);

    if (decision.kycOutcome === 'retry') {
      await this.provider.onRetry?.(settings, event, decision.target);
    }

    return this.buildOutcomeResult(
      event.onboardingId,
      resolvedConnector,
      buildKycSubmittedData(decision),
    );
  }

  /**
   * Resolves the declared identity through the connector's own `fieldMapping` — the only channel
   * from onboarding context into a connector payload (`docs/EXTENDING.md`). Mirrors
   * `WorkflowConnectorExecutorService.buildPayload`'s resolution exactly (payload only; this call
   * site has no use for `payloadFieldSources`), kept local because that method is private to its
   * own service. Reading `context` directly by the connector's own payload key names would
   * silently ignore a workflow's `fieldMapping` and break every deployment that renames a field.
   */
  private compareIdentity(
    verified: KycVerifiedIdentity | undefined,
    resolvedConnector: AwaitingCallbackConnectorResolution,
  ): KycIdentityComparison {
    const context = resolvedConnector.onboarding.context;
    const payload: Record<string, unknown> = {};

    for (const [payloadField, sourceField] of Object.entries(
      resolvedConnector.connector.fieldMapping,
    )) {
      if (!Object.prototype.hasOwnProperty.call(context, sourceField)) {
        throw new ConnectorPayloadFieldNotFoundError(sourceField, this.type, this.name);
      }

      payload[payloadField] = context[sourceField];
    }

    const { lastName, dateOfBirth } = buildKycApplicant(this.id, payload);

    return compareDeclaredIdentity({ lastName, dateOfBirth }, verified);
  }

  /**
   * One line per retry, per exhausted attempt cap, per human review the provider asked for, and
   * per identity-guard firing. Each carries only ids, field names and counts — never the compared
   * values and never a provider's free text.
   */
  private logDecision(onboardingId: string, evaluation: KycAppliedEvaluation): void {
    const subject = `connectorId=${this.id} onboardingId=${onboardingId}`;

    if (evaluation.kycOutcome === 'retry') {
      this.logger.log(
        `KYC_RETRY ${subject} target=${evaluation.target} attempts=${evaluation.attempts} ` +
          `maxAttemptsPerDocSet=${evaluation.maxAttemptsPerDocSet}`,
      );
      return;
    }

    if (evaluation.kycOutcome !== 'human_review') {
      return;
    }

    if (evaluation.reason === 'attempts_exhausted') {
      this.logger.log(
        `KYC_ATTEMPTS_EXHAUSTED ${subject} target=${evaluation.target} ` +
          `attempts=${evaluation.attempts} maxAttemptsPerDocSet=${evaluation.maxAttemptsPerDocSet}`,
      );
      return;
    }

    if (evaluation.reason === 'needs_review') {
      const counts = Object.entries(evaluation.detail ?? {})
        .map(([key, value]) => ` ${key}=${value}`)
        .join('');

      this.logger.log(`KYC_NEEDS_REVIEW ${subject} reason=${evaluation.providerReason}${counts}`);
      return;
    }

    this.logger.log(
      `KYC_IDENTITY_GUARD_FIRED ${subject} mismatchKind=${evaluation.mismatchKind} ` +
        `divergedFields=${JSON.stringify(evaluation.divergedFields)}`,
    );
  }

  /** Re-parks the step with no decision applied — the redelivery-safe "acknowledge" response. */
  private buildParkedResult(
    onboardingId: string,
    resolvedConnector: AwaitingCallbackConnectorResolution,
  ): ConnectorCallbackResult {
    return {
      onboardingId,
      submittedData: {},
      resolvedConnector,
      // The stored record is spread first, or the re-park would forget the attempt it still
      // waits on and when it started waiting.
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
    submittedData: KycCallbackSubmission,
  ): ConnectorCallbackResult {
    return {
      onboardingId,
      submittedData,
      resolvedConnector,
      result: ConnectorExecutionResult.accepted(),
    };
  }
}
