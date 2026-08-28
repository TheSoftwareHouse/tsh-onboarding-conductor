import { Inject, Injectable, Logger } from '@nestjs/common';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../../storage/object-storage.port';
import { ConnectorApplicantReferencesRepository } from '../../connector-applicant-references.repository';
import { ConnectorSettingsService } from '../../connector-settings.service';
import { ConnectorCallbackAlreadyAppliedError } from '../../errors/connector-callback-already-applied.error';
import { ConnectorPayloadFieldNotFoundError } from '../../errors/connector-payload-field-not-found.error';
import {
  AwaitingCallbackConnectorResolver,
  type AwaitingCallbackConnectorResolution,
} from '../../resolvers/awaiting-callback-connector.resolver';
import { CompletedOnboardingDocumentResolver } from '../../resolvers/completed-onboarding-document.resolver';
import type {
  ConnectorAdapter,
  ConnectorCallbackHmacAuth,
  ConnectorCallbackMappingInput,
  ConnectorExecutionInput,
  ConnectorSettingsSchema,
} from '../../ports/connector-adapter.port';
import {
  ConnectorExecutionResult,
  type ConnectorCallbackResult,
} from '../../ports/connector-execution-result';
import {
  buildFixedInfo,
  compareDeclaredIdentity,
  type SumsubIdentityComparisonField,
} from './sumsub-kyc/sumsub-applicant';
import {
  parseSumsubConfig,
  SUMSUB_KYC_SETTINGS_SCHEMA,
  type SumsubConfig,
  type SumsubDocumentMapping,
} from './sumsub-kyc/sumsub-config';
import {
  SUMSUB_CALLBACK_EVENT_APPLICANT_AWAITING_SERVICE,
  SUMSUB_CALLBACK_EVENT_APPLICANT_ON_HOLD,
  SUMSUB_CALLBACK_EVENT_APPLICANT_PENDING,
  SUMSUB_CALLBACK_EVENT_APPLICANT_REVIEWED,
  SUMSUB_CALLBACK_EVENT_ONGOING_DOC_EXPIRED,
  SUMSUB_DOC_SET_KEYS,
  type SumsubCallbackSubmission,
  type SumsubDocSetKey,
} from './sumsub-kyc/sumsub-contract';
import {
  evaluateSumsubOutcome,
  type SumsubOutcomeEvaluation,
  type SumsubScreeningHit,
} from './sumsub-kyc/sumsub-outcome';
import {
  buildSumsubQuestionnaireBody,
  type SumsubQuestionnaireAnswers,
} from './sumsub-kyc/sumsub-questionnaire';
import {
  SumsubClient,
  type SumsubAmlCase,
  type SumsubApplicantStatus,
  type SumsubCredentials,
  type SumsubLevel,
  type SumsubRequiredIdDocsStatus,
} from './sumsub-kyc/sumsub-client';

/**
 * The configured Sumsub level does not exist on the tenant. Thrown before any side-effecting
 * call — before `createApplicant` — so a detected drift costs nothing at Sumsub. The onboarding
 * stays on its current step with everything the customer already submitted intact; the engine
 * persists submitted step data before connectors run.
 */
export class SumsubLevelNotFoundError extends Error {
  constructor(levelName: string) {
    super(`sumsub_kyc level "${levelName}" was not found on the Sumsub tenant`);
    this.name = 'SumsubLevelNotFoundError';
  }
}

/**
 * The configured document list's `idDocSetType` values diverge from the Sumsub level's actual
 * `docSets` — in either direction. Names both sides so an operator can reconcile `config` or the
 * Sumsub level without guessing.
 */
export class SumsubLevelDocSetMismatchError extends Error {
  constructor(configuredDocSetTypes: readonly string[], levelDocSetTypes: readonly string[]) {
    super(
      `sumsub_kyc configured document docSets [${configuredDocSetTypes.join(', ')}] do not match ` +
        `the Sumsub level's docSets [${levelDocSetTypes.join(', ')}]`,
    );
    this.name = 'SumsubLevelDocSetMismatchError';
  }
}

/** The algorithm name this connector's `callbackAuth` signs with, per Sumsub's own convention. */
const SUMSUB_CALLBACK_EXPECTED_DIGEST_ALG = 'HMAC_SHA256_HEX';

/**
 * `X-Payload-Digest-Alg` did not name the algorithm this connector's `callbackAuth` signs with.
 * A real algorithm downgrade already fails the engine's HMAC comparison — this assertion exists
 * only to produce a precise error instead of a generic digest mismatch (defence in depth).
 */
export class SumsubCallbackDigestAlgorithmMismatchError extends Error {
  constructor(actual: string | undefined) {
    super(
      `sumsub_kyc callback X-Payload-Digest-Alg was "${actual ?? 'missing'}", expected ` +
        `"${SUMSUB_CALLBACK_EXPECTED_DIGEST_ALG}"`,
    );
    this.name = 'SumsubCallbackDigestAlgorithmMismatchError';
  }
}

/**
 * The callback's `applicantId` disagrees with the applicant id already stored for this
 * onboarding — a mis-correlated delivery, not a stale one. Thrown rather than applied, so Sumsub
 * redelivers instead of a verdict landing on the wrong customer. A *missing* stored reference is
 * tolerated elsewhere (the onboarding may predate the store); only a *mismatching* one throws.
 */
export class SumsubCallbackApplicantMismatchError extends Error {
  constructor(onboardingId: string, storedApplicantId: string, callbackApplicantId: string) {
    super(
      `sumsub_kyc callback applicantId="${callbackApplicantId}" for onboarding id=${onboardingId} ` +
        `does not match the stored applicantId="${storedApplicantId}"`,
    );
    this.name = 'SumsubCallbackApplicantMismatchError';
  }
}

type SumsubCallbackPayload = Readonly<{
  type: string;
  externalUserId: string;
  applicantId: string;
}>;

type SumsubCallbackClassification =
  'non_actionable' | 'on_hold_or_awaiting_service' | 'reviewed' | 'unrecognised';

/**
 * Submits an onboarding's captured identity data to Sumsub and parks the step for the provider's
 * callback. Every outcome the callback later reports is `accepted()` — the adapter never chooses
 * the next step, the workflow document routes on `kycOutcome`.
 */
@Injectable()
export class SumsubKycConnector implements ConnectorAdapter {
  private readonly logger = new Logger(SumsubKycConnector.name);

  readonly name = 'sumsub_kyc';
  readonly id = 'sumsub_kyc';
  readonly type = 'kyc' as const;
  readonly supportsAsyncCallback = true;
  readonly callbackAuth: ConnectorCallbackHmacAuth = {
    kind: 'hmac',
    algorithm: 'sha256',
    signatureHeader: 'x-payload-digest',
    encoding: 'hex',
  };
  readonly settingsSchema: ConnectorSettingsSchema = SUMSUB_KYC_SETTINGS_SCHEMA;

  constructor(
    private readonly sumsubClient: SumsubClient,
    private readonly connectorSettingsService: ConnectorSettingsService,
    private readonly documentResolver: CompletedOnboardingDocumentResolver,
    private readonly applicantReferences: ConnectorApplicantReferencesRepository,
    @Inject(OBJECT_STORAGE_PORT) private readonly objectStoragePort: ObjectStoragePort,
    private readonly awaitingCallbackConnectorResolver: AwaitingCallbackConnectorResolver,
  ) {}

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const config = parseSumsubConfig(input.declaration.config);
    const credentials = await this.resolveCredentials();

    await this.assertLevelMatchesConfig(credentials, config);

    const onboardingId = input.execution.onboardingId;
    const applicantId = await this.sumsubClient.createApplicant(credentials, config.levelName, {
      externalUserId: onboardingId,
      sourceKey: config.sourceKey,
      fixedInfo: buildFixedInfo(input.payload),
    });

    await this.applicantReferences.save({
      onboardingId,
      connectorId: this.id,
      applicantId,
    });

    for (const document of config.documents) {
      const uploaded = await this.uploadDocument(input, document, applicantId, credentials);

      if (!uploaded) {
        return ConnectorExecutionResult.invalid();
      }
    }

    await this.sumsubClient.submitQuestionnaire(credentials, applicantId, {
      id: config.questionnaireDefinitionId,
      ...buildSumsubQuestionnaireBody(
        config.questionnairePathMap,
        this.resolveQuestionnaireAnswers(config, input.payload),
      ),
    });

    await this.sumsubClient.finalizeSubmission(credentials, applicantId);

    return ConnectorExecutionResult.accepted();
  }

  /**
   * Steps 7-12: assert the digest algorithm, correlate the callback to an onboarding still
   * awaiting it, assert that correlation against the stored applicant reference, classify the
   * webhook `type`, read back the verdict Sumsub actually holds (never trusting the webhook body
   * for it), and decide through the ordered table in `sumsub-outcome.ts`.
   */
  async mapCallbackResult(input: ConnectorCallbackMappingInput): Promise<ConnectorCallbackResult> {
    this.assertDigestAlgorithm(input.headers);

    const callback = this.parseCallbackPayload(input.rawBody);

    const resolvedConnector = await this.awaitingCallbackConnectorResolver.findConnector({
      onboardingId: callback.externalUserId,
      connectorId: this.id,
    });

    if (!resolvedConnector) {
      throw new ConnectorCallbackAlreadyAppliedError(callback.externalUserId, this.id);
    }

    await this.assertApplicantCorrelation(callback);

    const classification = this.classifyCallbackEventType(callback.type);

    if (classification === 'non_actionable' || classification === 'unrecognised') {
      if (classification === 'non_actionable') {
        this.logger.debug(
          `SUMSUB_CALLBACK_ACKNOWLEDGED onboardingId=${callback.externalUserId} type=${callback.type}`,
        );
      }

      return this.buildParkedResult(callback.externalUserId, resolvedConnector);
    }

    if (classification === 'on_hold_or_awaiting_service') {
      const submittedData = this.buildSubmittedData(
        { kycOutcome: 'human_review', reason: 'on_hold_or_awaiting_service' },
        undefined,
        undefined,
      );

      return this.buildOutcomeResult(callback.externalUserId, resolvedConnector, submittedData);
    }

    const credentials = await this.resolveCredentials();
    const status = await this.sumsubClient.findApplicantStatus(credentials, callback.applicantId);

    if (status.reviewStatus !== 'completed') {
      return this.buildParkedResult(callback.externalUserId, resolvedConnector);
    }

    const { evaluation, divergedIdentityFields } = await this.evaluateReviewedCallback(
      callback,
      credentials,
      status,
      resolvedConnector,
    );

    this.logOutcomeEvaluation(callback.externalUserId, evaluation, divergedIdentityFields);

    if (evaluation.kycOutcome === 'retry') {
      await this.sumsubClient.resetStep(credentials, callback.applicantId, evaluation.docSet);
    }

    const submittedData = this.buildSubmittedData(
      evaluation,
      status.reviewResult?.moderationComment,
      status.reviewResult?.buttonIds,
    );

    return this.buildOutcomeResult(callback.externalUserId, resolvedConnector, submittedData);
  }

  private async resolveCredentials(): Promise<SumsubCredentials> {
    const settings = await this.connectorSettingsService.resolve(this);

    return {
      appToken: settings.get('appToken'),
      secretKey: settings.get('secretKey'),
    };
  }

  /**
   * The level check runs before any side-effecting call. `config` is the source of truth for the
   * document list; Sumsub's level is read only to prove the two still agree. Not cached — the
   * check runs on every execution, so a level changed at Sumsub after the first fetch is never
   * missed.
   */
  private async assertLevelMatchesConfig(
    credentials: SumsubCredentials,
    config: SumsubConfig,
  ): Promise<void> {
    const level = await this.sumsubClient.findLevel(credentials, config.levelName);

    if (!level) {
      throw new SumsubLevelNotFoundError(config.levelName);
    }

    const configuredDocSetTypes = this.uniqueSorted(
      config.documents.map((document) => document.idDocSetType),
    );
    const levelDocSetTypes = this.uniqueSorted(this.readLevelDocSetTypes(level));

    if (!this.sameMembers(configuredDocSetTypes, levelDocSetTypes)) {
      throw new SumsubLevelDocSetMismatchError(configuredDocSetTypes, levelDocSetTypes);
    }
  }

  private readLevelDocSetTypes(level: SumsubLevel): readonly string[] {
    return level.docSets.map((entry) => entry.idDocSetType);
  }

  private uniqueSorted(values: readonly string[]): readonly string[] {
    return [...new Set(values)].sort();
  }

  private sameMembers(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  /** Resolves and uploads one configured document. Returns false when it fails to resolve. */
  private async uploadDocument(
    input: ConnectorExecutionInput,
    document: SumsubDocumentMapping,
    applicantId: string,
    credentials: SumsubCredentials,
  ): Promise<boolean> {
    const documentId = input.payload[document.payloadField];

    if (typeof documentId !== 'string' || documentId.trim().length === 0) {
      return false;
    }

    const resolved = await this.documentResolver.resolve({
      documentId,
      onboardingId: input.execution.onboardingId,
      stepName: input.execution.stepName,
      sourceField: this.resolveSourceField(input, document.payloadField),
    });

    if (!resolved) {
      return false;
    }

    const fileContent = await this.objectStoragePort.readObject({
      objectKey: resolved.finalObjectKey,
      expectedEtag: resolved.verifiedEtag,
      maxBytes: resolved.verifiedSizeBytes,
    });

    await this.sumsubClient.uploadIdDoc(credentials, {
      applicantId,
      metadata: {
        idDocType: document.idDocType,
        ...(document.idDocSubType ? { idDocSubType: document.idDocSubType } : {}),
        country: document.country,
      },
      // `DocumentUploadService.buildFinalObjectKey` always ends in the literal segment `final`
      // (`onboardings/{id}/{documentId}/final`), so the last path segment is never
      // distinguishing. `documentId` is, across every document of an applicant.
      fileName: documentId,
      contentType: 'application/octet-stream',
      fileContent,
    });

    return true;
  }

  private resolveSourceField(input: ConnectorExecutionInput, payloadField: string): string {
    const source = input.payloadFieldSources[payloadField];

    return typeof source === 'string' ? source : payloadField;
  }

  /**
   * Every configured questionnaire item key is read from the connector payload. A value that is
   * neither a string nor a boolean is treated as absent — the same as a key missing entirely —
   * which is how `buildSumsubQuestionnaireBody` recognises a conditional item whose condition did
   * not hold. Conditional evaluation is upstream of that function by design; this is where it
   * happens.
   */
  private resolveQuestionnaireAnswers(
    config: SumsubConfig,
    payload: Readonly<Record<string, unknown>>,
  ): SumsubQuestionnaireAnswers {
    const answers: Record<string, string | boolean | undefined> = {};

    for (const itemKey of Object.keys(config.questionnairePathMap)) {
      const value = payload[itemKey];
      answers[itemKey] =
        typeof value === 'string' || typeof value === 'boolean' ? value : undefined;
    }

    return answers;
  }

  private assertDigestAlgorithm(headers: Readonly<Record<string, string | undefined>>): void {
    const headerValue = headers['x-payload-digest-alg'];

    if (headerValue !== SUMSUB_CALLBACK_EXPECTED_DIGEST_ALG) {
      throw new SumsubCallbackDigestAlgorithmMismatchError(headerValue);
    }
  }

  private parseCallbackPayload(rawBody: Uint8Array): SumsubCallbackPayload {
    let decoded: string;

    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
    } catch {
      throw new Error('sumsub_kyc callback body must be valid UTF-8');
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(decoded);
    } catch {
      throw new Error('sumsub_kyc callback body must be valid JSON');
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('sumsub_kyc callback JSON body must be an object');
    }

    const record = parsed as Record<string, unknown>;

    return {
      type: this.requireNonEmptyString(record.type, 'type'),
      externalUserId: this.requireNonEmptyString(record.externalUserId, 'externalUserId'),
      applicantId: this.requireNonEmptyString(record.applicantId, 'applicantId'),
    };
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`sumsub_kyc callback body missing required field "${field}"`);
    }

    return value;
  }

  /**
   * A missing stored reference is tolerated (the onboarding may predate the store); a
   * mismatching one is a mis-correlated delivery and throws.
   */
  private async assertApplicantCorrelation(callback: SumsubCallbackPayload): Promise<void> {
    const storedApplicantId = await this.applicantReferences.findByOnboarding({
      onboardingId: callback.externalUserId,
      connectorId: this.id,
    });

    if (storedApplicantId !== undefined && storedApplicantId !== callback.applicantId) {
      throw new SumsubCallbackApplicantMismatchError(
        callback.externalUserId,
        storedApplicantId,
        callback.applicantId,
      );
    }
  }

  /**
   * Evaluation order is explicit because the event table has overlapping rows: `ongoingDocExpired`
   * is checked before a pending event reads as "review started", and `applicantOnHold` /
   * `applicantAwaitingService` are checked before the generic "not completed" fallback that lives
   * inside the `reviewed` branch of `mapCallbackResult`.
   */
  private classifyCallbackEventType(type: string): SumsubCallbackClassification {
    if (type === SUMSUB_CALLBACK_EVENT_ONGOING_DOC_EXPIRED) {
      return 'non_actionable';
    }

    if (type === SUMSUB_CALLBACK_EVENT_APPLICANT_PENDING) {
      return 'non_actionable';
    }

    if (
      type === SUMSUB_CALLBACK_EVENT_APPLICANT_ON_HOLD ||
      type === SUMSUB_CALLBACK_EVENT_APPLICANT_AWAITING_SERVICE
    ) {
      return 'on_hold_or_awaiting_service';
    }

    if (type === SUMSUB_CALLBACK_EVENT_APPLICANT_REVIEWED) {
      return 'reviewed';
    }

    return 'unrecognised';
  }

  /**
   * Gathers everything the ordered table needs for a completed review: the screening case, the
   * verified identity block (and, only on RED, the per-step verdict for the failed docSet), then
   * evaluates. `divergedIdentityFields` is instrumentation only, computed alongside the decision
   * so the caller can log it without redoing the read.
   */
  private async evaluateReviewedCallback(
    callback: SumsubCallbackPayload,
    credentials: SumsubCredentials,
    status: SumsubApplicantStatus,
    resolvedConnector: AwaitingCallbackConnectorResolution,
  ): Promise<{
    evaluation: SumsubOutcomeEvaluation;
    divergedIdentityFields: readonly SumsubIdentityComparisonField[];
  }> {
    const config = parseSumsubConfig(resolvedConnector.connector.config);

    const [verifiedInfo, amlCase] = await Promise.all([
      this.sumsubClient.findApplicant(credentials, callback.applicantId),
      this.sumsubClient.findAmlCase(credentials, callback.applicantId),
    ]);

    const reviewAnswer = status.reviewResult?.reviewAnswer;
    const reviewRejectType = status.reviewResult?.reviewRejectType;

    let failedDocSet: SumsubDocSetKey | undefined;
    let attemptCnt: number | undefined;

    if (reviewAnswer === 'RED') {
      const requiredIdDocsStatus = await this.sumsubClient.findRequiredIdDocsStatus(
        credentials,
        callback.applicantId,
      );
      const failed = this.findFailedDocSet(requiredIdDocsStatus);
      failedDocSet = failed?.docSet;
      attemptCnt = failed?.attemptCnt;
    }

    const declaredPayload = this.resolveDeclaredPayload(
      resolvedConnector.connector.fieldMapping,
      resolvedConnector.onboarding.context,
    );
    const declared = buildFixedInfo(declaredPayload);
    const identityComparison = compareDeclaredIdentity(declared, verifiedInfo);

    const evaluation = evaluateSumsubOutcome({
      isOnHoldOrAwaitingService: false,
      screeningHits: this.normalizeScreeningHits(amlCase),
      identityComparison: identityComparison.result,
      reviewAnswer,
      reviewRejectType,
      attemptCnt,
      maxAttemptsPerDocSet: config.maxAttemptsPerDocSet,
      failedDocSet,
    });

    return {
      evaluation,
      divergedIdentityFields: identityComparison.divergedFields,
    };
  }

  /**
   * Resolves the callback path's declared identity through the connector's own `fieldMapping` —
   * the only channel from onboarding context into a connector payload (`docs/EXTENDING.md`).
   * Mirrors `WorkflowConnectorExecutorService.buildPayload`'s resolution exactly (payload only;
   * this call site has no use for `payloadFieldSources`), kept local because that method is
   * private to its own service. Reading `context` directly by the connector's own payload key
   * names — `firstName`, `lastName`, and so on — would silently ignore a workflow's `fieldMapping`
   * and break every deployment that renames a field.
   */
  private resolveDeclaredPayload(
    fieldMapping: Readonly<Record<string, string>>,
    context: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    for (const [payloadField, sourceField] of Object.entries(fieldMapping)) {
      if (!Object.prototype.hasOwnProperty.call(context, sourceField)) {
        throw new ConnectorPayloadFieldNotFoundError(sourceField, this.type, this.name);
      }

      payload[payloadField] = context[sourceField];
    }

    return payload;
  }

  /**
   * Per-step verdicts are read only when RED. Parses defensively: after a step reset, an entry
   * exists with `reviewResult` absent, and a naive access would throw.
   */
  private findFailedDocSet(
    requiredIdDocsStatus: SumsubRequiredIdDocsStatus,
  ): { docSet: SumsubDocSetKey; attemptCnt: number } | undefined {
    for (const docSetKey of SUMSUB_DOC_SET_KEYS) {
      const entry = requiredIdDocsStatus[docSetKey];

      if (typeof entry !== 'object' || entry === null) {
        continue;
      }

      const record = entry as Record<string, unknown>;
      const reviewResult = record.reviewResult;

      if (typeof reviewResult !== 'object' || reviewResult === null) {
        continue;
      }

      if ((reviewResult as Record<string, unknown>).reviewAnswer !== 'RED') {
        continue;
      }

      // A missing or non-numeric attemptCnt is not an unrecognisable provider state — Sumsub
      // just did not report a count for this docSet. Treated as 0 so a resolvable RED/RETRY
      // docSet still reaches row 6 instead of dead-ending at row 8 (throw -> 5xx -> redelivery
      // loses the verdict after Sumsub's six retries).
      const attemptCnt = typeof record.attemptCnt === 'number' ? record.attemptCnt : 0;

      return { docSet: docSetKey, attemptCnt };
    }

    return undefined;
  }

  /**
   * `undefined` is Sumsub's `204` — no case at all, kept distinct from an empty array (a case
   * that exists with zero hits) all the way into the outcome table.
   */
  private normalizeScreeningHits(
    amlCase: SumsubAmlCase | undefined,
  ): readonly SumsubScreeningHit[] | undefined {
    if (!amlCase) {
      return undefined;
    }

    return amlCase.hits.map((hit) =>
      typeof hit === 'object' && hit !== null ? (hit as SumsubScreeningHit) : {},
    );
  }

  /**
   * The three Definition-of-Done logging requirements: one line per RETRY outcome, one line per
   * screening hit, one line per row-3 (identity guard) firing. Each carries only names and counts
   * that are safe to log — never the compared values, never a hit's free-text fields.
   */
  private logOutcomeEvaluation(
    onboardingId: string,
    evaluation: SumsubOutcomeEvaluation,
    divergedIdentityFields: readonly SumsubIdentityComparisonField[],
  ): void {
    if (evaluation.kycOutcome === 'retry') {
      this.logger.log(
        `SUMSUB_KYC_RETRY onboardingId=${onboardingId} docSet=${evaluation.docSet} ` +
          `attemptCnt=${evaluation.attemptCnt} maxAttemptsPerDocSet=${evaluation.maxAttemptsPerDocSet}`,
      );
      return;
    }

    if (evaluation.kycOutcome !== 'human_review') {
      return;
    }

    if (evaluation.reason === 'attempts_exhausted') {
      this.logger.log(
        `SUMSUB_KYC_ATTEMPTS_EXHAUSTED onboardingId=${onboardingId} docSet=${evaluation.docSet} ` +
          `attemptCnt=${evaluation.attemptCnt} maxAttemptsPerDocSet=${evaluation.maxAttemptsPerDocSet}`,
      );
      return;
    }

    if (evaluation.reason === 'screening_unresolved' && evaluation.unresolvedHit) {
      const entryKeys = Object.keys(evaluation.unresolvedHit);
      this.logger.log(
        `SUMSUB_SCREENING_HIT_UNRESOLVED onboardingId=${onboardingId} ` +
          `entryKeys=${JSON.stringify(entryKeys)} ` +
          `matchStatus=${JSON.stringify(evaluation.unresolvedHit.matchStatus)} ` +
          `hitCount=${evaluation.hitCount}`,
      );
      return;
    }

    if (evaluation.reason === 'identity_guard') {
      this.logger.log(
        `SUMSUB_IDENTITY_GUARD_FIRED onboardingId=${onboardingId} mismatchKind=${evaluation.mismatchKind} ` +
          `divergedFields=${JSON.stringify(divergedIdentityFields)}`,
      );
    }
  }

  /**
   * Maps the row that fired to the closed `SumsubCallbackSubmission` — the only shape that
   * crosses into `submittedData`, and therefore into the audit log, twice.
   */
  private buildSubmittedData(
    evaluation: SumsubOutcomeEvaluation,
    moderationComment: string | undefined,
    buttonIds: readonly string[] | undefined,
  ): SumsubCallbackSubmission {
    switch (evaluation.kycOutcome) {
      case 'retry':
        return {
          kycOutcome: 'retry',
          kycRetryStep: evaluation.docSet,
          ...this.buildReasonFields(moderationComment, buttonIds),
        };
      case 'refused':
        return { kycOutcome: 'refused', ...this.buildReasonFields(moderationComment, buttonIds) };
      case 'verified':
        return { kycOutcome: 'verified' };
      case 'human_review':
        return { kycOutcome: 'human_review' };
    }
  }

  private buildReasonFields(
    moderationComment: string | undefined,
    buttonIds: readonly string[] | undefined,
  ): Pick<SumsubCallbackSubmission, 'kycReasonCodes' | 'kycCustomerMessage'> {
    const fields: Pick<SumsubCallbackSubmission, 'kycReasonCodes' | 'kycCustomerMessage'> = {};

    if (buttonIds && buttonIds.length > 0) {
      fields.kycReasonCodes = buttonIds;
    }

    if (moderationComment) {
      fields.kycCustomerMessage = moderationComment;
    }

    return fields;
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
      result: ConnectorExecutionResult.pending({
        connectorName: this.name,
        connectorId: this.id,
        connectorOrder: resolvedConnector.connectorOrder,
      }),
    };
  }

  private buildOutcomeResult(
    onboardingId: string,
    resolvedConnector: AwaitingCallbackConnectorResolution,
    submittedData: SumsubCallbackSubmission,
  ): ConnectorCallbackResult {
    return {
      onboardingId,
      submittedData,
      resolvedConnector,
      result: ConnectorExecutionResult.accepted(),
    };
  }
}
