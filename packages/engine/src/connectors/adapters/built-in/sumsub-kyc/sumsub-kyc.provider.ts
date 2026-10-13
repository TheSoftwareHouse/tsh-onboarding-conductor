import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedConnectorSettings } from '../../../connector-settings.service';
import type {
  ConnectorCallbackHmacAuth,
  ConnectorCallbackMappingInput,
  ConnectorSettingsSchema,
} from '../../../ports/connector-adapter.port';
import { toAlpha3 } from '../kyc/kyc-country';
import type { KycConfig } from '../kyc/kyc-config';
import type { KycRetryTarget } from '../kyc/kyc-contract';
import type {
  KycCallbackEvent,
  KycDocument,
  KycPendingReference,
  KycProvider,
  KycSubmission,
  KycSubmissionReceipt,
  KycVerdict,
} from '../kyc/kyc-provider.port';
import { buildFixedInfo } from './sumsub-applicant';
import {
  SumsubClient,
  type SumsubCredentials,
  type SumsubLevel,
  type SumsubRequiredIdDocsStatus,
} from './sumsub-client';
import {
  parseSumsubProviderConfig,
  requireQuestionnairePathMap,
  SUMSUB_KYC_SETTINGS_SCHEMA,
  SumsubConfigInvalidError,
} from './sumsub-config';
import {
  SUMSUB_CALLBACK_EVENT_APPLICANT_AWAITING_SERVICE,
  SUMSUB_CALLBACK_EVENT_APPLICANT_ON_HOLD,
  SUMSUB_CALLBACK_EVENT_APPLICANT_REVIEWED,
  SUMSUB_DOC_SET_KEYS,
  SUMSUB_DOC_SET_QUESTIONNAIRE,
  SUMSUB_KYC_CONNECTOR_ID,
  type SumsubDocSetKey,
} from './sumsub-contract';
import {
  findFirstUnresolvedHit,
  mapSumsubOutcomeToVerdict,
  SUMSUB_REASON_ON_HOLD_OR_AWAITING_SERVICE,
  SUMSUB_REASON_SCREENING_UNRESOLVED,
  type SumsubScreeningHit,
} from './sumsub-outcome';
import { buildSumsubQuestionnaireBody } from './sumsub-questionnaire';

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
 * A submitted document's `idDocSetType` is absent from the Sumsub level's actual `docSets`. The
 * reverse is not an error: a level legitimately carries steps the adapter uploads nothing into
 * (`APPLICANT_DATA`, `QUESTIONNAIRE`). Names both sides so an operator can reconcile `config` or
 * the Sumsub level without guessing.
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

/**
 * The level has no `QUESTIONNAIRE` docSet, so the questionnaire `submit()` sends has nowhere to
 * land. Thrown alongside the docSet check, before any side-effecting call, because the failure it
 * predicts would otherwise appear much later as an unexplained rejection at Sumsub.
 */
export class SumsubLevelQuestionnaireMissingError extends Error {
  constructor(levelName: string, levelDocSetTypes: readonly string[]) {
    super(
      `sumsub_kyc level "${levelName}" declares no ${SUMSUB_DOC_SET_QUESTIONNAIRE} docSet ` +
        `(its docSets are [${levelDocSetTypes.join(', ')}]), but the connector config declares a ` +
        `questionnaire to submit`,
    );
    this.name = 'SumsubLevelQuestionnaireMissingError';
  }
}

/** The algorithm name this provider's `callbackAuth` signs with, per Sumsub's own convention. */
const SUMSUB_CALLBACK_EXPECTED_DIGEST_ALG = 'HMAC_SHA256_HEX';

/**
 * `X-Payload-Digest-Alg` did not name the algorithm this provider's `callbackAuth` signs with.
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

/** A Sumsub webhook always names the applicant, which the verdict read-back needs. */
export interface SumsubCallbackEvent extends KycCallbackEvent {
  readonly providerReference: string;
}

const HINT_ON_HOLD = 'on_hold';
const HINT_REVIEWED = 'reviewed';

/**
 * Sumsub on the KYC kernel: the signed HTTP calls and the mapping of Sumsub's review states onto
 * `KycVerdict`. Sumsub reports attempts itself (per-docSet `attemptCnt`), so the kernel never
 * counts for it.
 */
@Injectable()
export class SumsubKycProvider implements KycProvider<SumsubCallbackEvent> {
  private readonly logger = new Logger(SumsubKycProvider.name);

  readonly id = SUMSUB_KYC_CONNECTOR_ID;
  readonly name = SUMSUB_KYC_CONNECTOR_ID;
  readonly settingsSchema: ConnectorSettingsSchema = SUMSUB_KYC_SETTINGS_SCHEMA;
  readonly callbackAuth: ConnectorCallbackHmacAuth = {
    kind: 'hmac',
    algorithm: 'sha256',
    signatureHeader: 'x-payload-digest',
    encoding: 'hex',
  };
  readonly countsAttempts = true;

  constructor(private readonly sumsubClient: SumsubClient) {}

  validateConfig(providerConfig: Readonly<Record<string, unknown>>, config: KycConfig): void {
    parseSumsubProviderConfig(providerConfig);
    requireQuestionnairePathMap(config.questionnairePathMap);
  }

  async submit(
    settings: ResolvedConnectorSettings,
    submission: KycSubmission,
  ): Promise<KycSubmissionReceipt> {
    const credentials = this.readCredentials(settings);
    const { levelName, questionnaireDefinitionId } = parseSumsubProviderConfig(
      submission.providerConfig,
    );
    const questionnaire = submission.questionnaire;

    if (!questionnaire) {
      throw new SumsubConfigInvalidError('questionnairePathMap', 'must be a non-empty object');
    }

    await this.assertLevelMatchesDocuments(credentials, levelName, submission.documents);

    const applicantId = await this.sumsubClient.createApplicant(credentials, levelName, {
      externalUserId: submission.onboardingId,
      sourceKey: submission.sourceKey,
      fixedInfo: buildFixedInfo(submission.applicant),
    });

    for (const document of submission.documents) {
      await this.sumsubClient.uploadIdDoc(credentials, {
        applicantId,
        metadata: {
          idDocType: document.docType,
          ...(document.side ? { idDocSubType: document.side } : {}),
          country: toAlpha3(document.country, 'country'),
        },
        // `DocumentUploadService.buildFinalObjectKey` always ends in the literal segment `final`
        // (`onboardings/{id}/{documentId}/final`), so the last path segment is never
        // distinguishing. `documentId` is, across every document of an applicant.
        fileName: document.documentId,
        contentType: 'application/octet-stream',
        fileContent: document.content,
      });
    }

    await this.sumsubClient.submitQuestionnaire(credentials, applicantId, {
      id: questionnaireDefinitionId,
      ...buildSumsubQuestionnaireBody(questionnaire.pathMap, questionnaire.answers),
    });

    await this.sumsubClient.finalizeSubmission(credentials, applicantId);

    return { providerReference: applicantId };
  }

  /**
   * Asserts the digest algorithm and reduces the webhook to what the kernel acts on. Only
   * `applicantReviewed`, `applicantOnHold` and `applicantAwaitingService` decide anything; every
   * other `type` — including one Sumsub invents later — is acknowledged and dropped.
   */
  parseCallback(input: ConnectorCallbackMappingInput): SumsubCallbackEvent {
    const digestAlg = input.headers['x-payload-digest-alg'];

    if (digestAlg !== SUMSUB_CALLBACK_EXPECTED_DIGEST_ALG) {
      throw new SumsubCallbackDigestAlgorithmMismatchError(digestAlg);
    }

    const record = this.parseCallbackBody(input.rawBody);
    const type = this.requireNonEmptyString(record.type, 'type');
    const event = {
      onboardingId: this.requireNonEmptyString(record.externalUserId, 'externalUserId'),
      providerReference: this.requireNonEmptyString(record.applicantId, 'applicantId'),
    };

    if (
      type === SUMSUB_CALLBACK_EVENT_APPLICANT_ON_HOLD ||
      type === SUMSUB_CALLBACK_EVENT_APPLICANT_AWAITING_SERVICE
    ) {
      return { ...event, actionable: true, hint: HINT_ON_HOLD };
    }

    if (type === SUMSUB_CALLBACK_EVENT_APPLICANT_REVIEWED) {
      return { ...event, actionable: true, hint: HINT_REVIEWED };
    }

    return { ...event, actionable: false };
  }

  /** Read as a reviewed applicant: `fetchVerdict` already answers `pending` while the review runs. */
  buildReconcileEvent(reference: KycPendingReference): SumsubCallbackEvent {
    return { ...reference, actionable: true, hint: HINT_REVIEWED };
  }

  async fetchVerdict(
    settings: ResolvedConnectorSettings,
    event: SumsubCallbackEvent,
  ): Promise<KycVerdict> {
    if (event.hint === HINT_ON_HOLD) {
      return { kind: 'needs_review', reason: SUMSUB_REASON_ON_HOLD_OR_AWAITING_SERVICE };
    }

    const credentials = this.readCredentials(settings);
    const status = await this.sumsubClient.findApplicantStatus(
      credentials,
      event.providerReference,
    );

    if (status.reviewStatus !== 'completed') {
      return { kind: 'pending' };
    }

    const [verifiedInfo, amlCase] = await Promise.all([
      this.sumsubClient.findApplicant(credentials, event.providerReference),
      this.sumsubClient.findAmlCase(credentials, event.providerReference),
    ]);

    const failed =
      status.reviewResult?.reviewAnswer === 'RED'
        ? this.findFailedDocSet(
            await this.sumsubClient.findRequiredIdDocsStatus(credentials, event.providerReference),
          )
        : undefined;

    // `undefined` is Sumsub's `204` — no case at all, kept distinct from an empty array (a case
    // that exists with zero hits) all the way into the mapping.
    const screeningHits = amlCase?.hits.map((hit) =>
      typeof hit === 'object' && hit !== null ? (hit as SumsubScreeningHit) : {},
    );

    const verdict = mapSumsubOutcomeToVerdict({
      screeningHits,
      reviewAnswer: status.reviewResult?.reviewAnswer,
      reviewRejectType: status.reviewResult?.reviewRejectType,
      attemptCnt: failed?.attemptCnt,
      failedDocSet: failed?.docSet,
      moderationComment: status.reviewResult?.moderationComment,
      buttonIds: status.reviewResult?.buttonIds,
      verifiedInfo,
    });

    this.logUnresolvedScreening(event, verdict, screeningHits);

    return verdict;
  }

  async onRetry(
    settings: ResolvedConnectorSettings,
    event: SumsubCallbackEvent,
    target: KycRetryTarget,
  ): Promise<void> {
    await this.sumsubClient.resetStep(
      this.readCredentials(settings),
      event.providerReference,
      target,
    );
  }

  private readCredentials(settings: ResolvedConnectorSettings): SumsubCredentials {
    return {
      appToken: settings.get('appToken'),
      secretKey: settings.get('secretKey'),
    };
  }

  /**
   * The level check runs before any side-effecting call. The submitted documents are the source
   * of truth for the docSets; Sumsub's level is read only to prove the two still agree. Not
   * cached — the check runs on every execution, so a level changed at Sumsub after the first
   * fetch is never missed.
   *
   * Containment, not equality: the documents can only ever name docSets the adapter uploads a
   * file into, while a level legitimately carries steps that take no upload — `APPLICANT_DATA`
   * and `QUESTIONNAIRE` — so requiring the two sets to be equal would reject every level the
   * adapter is able to complete. A submitted docSet absent from the level is still drift and
   * still throws.
   */
  private async assertLevelMatchesDocuments(
    credentials: SumsubCredentials,
    levelName: string,
    documents: readonly KycDocument[],
  ): Promise<void> {
    const level = await this.sumsubClient.findLevel(credentials, levelName);

    if (!level) {
      throw new SumsubLevelNotFoundError(levelName);
    }

    const submittedDocSetTypes = this.uniqueSorted(documents.map((document) => document.docSet));
    const levelDocSetTypes = this.uniqueSorted(this.readLevelDocSetTypes(level));

    if (!submittedDocSetTypes.every((docSetType) => levelDocSetTypes.includes(docSetType))) {
      throw new SumsubLevelDocSetMismatchError(submittedDocSetTypes, levelDocSetTypes);
    }

    if (!levelDocSetTypes.includes(SUMSUB_DOC_SET_QUESTIONNAIRE)) {
      throw new SumsubLevelQuestionnaireMissingError(levelName, levelDocSetTypes);
    }
  }

  private readLevelDocSetTypes(level: SumsubLevel): readonly string[] {
    return level.docSets.map((entry) => entry.idDocSetType);
  }

  private uniqueSorted(values: readonly string[]): readonly string[] {
    return [...new Set(values)].sort();
  }

  private parseCallbackBody(rawBody: Uint8Array): Record<string, unknown> {
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

    return parsed as Record<string, unknown>;
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`sumsub_kyc callback body missing required field "${field}"`);
    }

    return value;
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
      // docSet still becomes a resubmission instead of throwing (throw -> 5xx -> redelivery
      // loses the verdict after Sumsub's six retries).
      const attemptCnt = typeof record.attemptCnt === 'number' ? record.attemptCnt : 0;

      return { docSet: docSetKey, attemptCnt };
    }

    return undefined;
  }

  /**
   * One line when screening holds a verdict back: only the entry key names, the `matchStatus`
   * and the hit count — never a hit's name, date of birth or free text.
   */
  private logUnresolvedScreening(
    event: SumsubCallbackEvent,
    verdict: KycVerdict,
    screeningHits: readonly SumsubScreeningHit[] | undefined,
  ): void {
    const unresolvedHit = findFirstUnresolvedHit(screeningHits);

    if (
      verdict.kind !== 'needs_review' ||
      verdict.reason !== SUMSUB_REASON_SCREENING_UNRESOLVED ||
      !unresolvedHit
    ) {
      return;
    }

    this.logger.log(
      `SUMSUB_SCREENING_HIT_UNRESOLVED onboardingId=${event.onboardingId} ` +
        `entryKeys=${JSON.stringify(Object.keys(unresolvedHit))} ` +
        `matchStatus=${JSON.stringify(unresolvedHit.matchStatus)} ` +
        `hitCount=${screeningHits?.length ?? 0}`,
    );
  }
}
