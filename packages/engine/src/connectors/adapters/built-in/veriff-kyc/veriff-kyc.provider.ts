import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedConnectorSettings } from '../../../connector-settings.service';
import type {
  ConnectorCallbackHmacAuth,
  ConnectorCallbackMappingInput,
  ConnectorSettingsSchema,
} from '../../../ports/connector-adapter.port';
import { KycConfigInvalidError, type KycConfig } from '../kyc/kyc-config';
import type { KycRetryTarget } from '../kyc/kyc-contract';
import type {
  KycCallbackEvent,
  KycPendingReference,
  KycDocument,
  KycProvider,
  KycSubmission,
  KycSubmissionReceipt,
  KycVerdict,
} from '../kyc/kyc-provider.port';
import { VeriffClient, type VeriffDecision } from './veriff-client';
import { resolveVeriffCredentials, VERIFF_KYC_SETTINGS_SCHEMA } from './veriff-config';
import { VeriffMediaFitter } from './veriff-media-fitter';
import {
  VERIFF_DECISION_STATUS_ABANDONED,
  VERIFF_DECISION_STATUS_APPROVED,
  VERIFF_DECISION_STATUS_DECLINED,
  VERIFF_DECISION_STATUS_EXPIRED,
  VERIFF_DECISION_STATUS_RESUBMISSION_REQUESTED,
  VERIFF_DECISION_STATUS_REVIEW,
  VERIFF_DOCUMENT_TYPES,
  VERIFF_FACE_RESUBMISSION_REASON_CODES,
  VERIFF_HEADER_AUTH_CLIENT,
  VERIFF_HEADER_HMAC_SIGNATURE,
  VERIFF_KYC_CONNECTOR_ID,
  VERIFF_MEDIA_CONTEXT_DOCUMENT_BACK,
  VERIFF_MEDIA_CONTEXT_DOCUMENT_FRONT,
  VERIFF_MEDIA_CONTEXT_FACE,
  VERIFF_REASON_CODE_RESUBMISSION_LIMIT_EXCEEDED,
  type VeriffDocumentType,
  type VeriffMediaContext,
} from './veriff-contract';

const DOC_SET_IDENTITY = 'IDENTITY';
const DOC_SET_SELFIE = 'SELFIE';
const SIDE_FRONT = 'FRONT_SIDE';
const SIDE_BACK = 'BACK_SIDE';

/**
 * `X-AUTH-CLIENT` on a callback did not carry the configured API key. The HMAC check already
 * proves the body is Veriff's; this names an integration mix-up precisely instead of letting it
 * surface as a missing onboarding.
 */
export class VeriffCallbackAuthClientMismatchError extends Error {
  constructor() {
    super(`veriff_kyc callback ${VERIFF_HEADER_AUTH_CLIENT} did not match the configured apiKey`);
    this.name = 'VeriffCallbackAuthClientMismatchError';
  }
}

/**
 * Veriff has no decision for the session yet. Thrown, not parked: no later event would follow a
 * decision webhook, so a 5xx is what makes Veriff redeliver it.
 */
export class VeriffDecisionNotAvailableError extends Error {
  constructor(sessionId: string) {
    super(`veriff_kyc session ${sessionId} has no decision yet`);
    this.name = 'VeriffDecisionNotAvailableError';
  }
}

/** The decision read back belongs to a different onboarding than the webhook named. */
export class VeriffDecisionVendorDataMismatchError extends Error {
  constructor(sessionId: string) {
    super(`veriff_kyc session ${sessionId} decision vendorData does not match the callback`);
    this.name = 'VeriffDecisionVendorDataMismatchError';
  }
}

/**
 * A decision status the mapping does not know. Carries status and code only — never the
 * free-text `reason` or any person data.
 */
export class VeriffDecisionUnrecognisedStateError extends Error {
  constructor(status: string, code: number | undefined) {
    super(`veriff_kyc decision has unrecognised status "${status}" (code ${code ?? 'none'})`);
    this.name = 'VeriffDecisionUnrecognisedStateError';
  }
}

/**
 * `origin: 'reconcile'` marks a read the engine makes on an operator's behalf: there is no
 * webhook to answer 5xx to, so a session with no decision yet is reported as pending instead.
 */
export interface VeriffCallbackEvent extends KycCallbackEvent {
  readonly providerReference?: string;
  readonly origin?: 'reconcile';
}

/**
 * The Veriff media context a configured document uploads as; `undefined` when none fits. Pure, so
 * `validateConfig` refuses at boot exactly what `submit` could not upload.
 */
export const resolveVeriffMediaContext = (document: {
  docSet: string;
  docType?: string;
  side?: string;
}): VeriffMediaContext | undefined => {
  if (document.docSet === DOC_SET_SELFIE) {
    return VERIFF_MEDIA_CONTEXT_FACE;
  }

  if (document.docSet !== DOC_SET_IDENTITY) {
    return undefined;
  }

  if (document.side === undefined || document.side === SIDE_FRONT) {
    return VERIFF_MEDIA_CONTEXT_DOCUMENT_FRONT;
  }

  return document.side === SIDE_BACK ? VERIFF_MEDIA_CONTEXT_DOCUMENT_BACK : undefined;
};

/** Face-related reason codes send the applicant back to the selfie; everything else to the ID. */
export const resolveVeriffRetryTarget = (reasonCode: number | undefined): KycRetryTarget =>
  reasonCode !== undefined &&
  (VERIFF_FACE_RESUBMISSION_REASON_CODES as readonly number[]).includes(reasonCode)
    ? 'SELFIE'
    : 'IDENTITY';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * Veriff on the KYC kernel, API-only: a fresh session is created per submission, the captured
 * images are uploaded to it and the session is submitted for a decision. Veriff reports no
 * attempt count, so the kernel counts resubmissions (`countsAttempts: false`).
 *
 * A new session every call, never a reused one: a Veriff session is single-use and a resubmission
 * after a `resubmission_requested` decision is a new verification (ADR 0034).
 */
@Injectable()
export class VeriffKycProvider implements KycProvider<VeriffCallbackEvent> {
  private readonly logger = new Logger(VeriffKycProvider.name);

  readonly id = VERIFF_KYC_CONNECTOR_ID;
  readonly name = VERIFF_KYC_CONNECTOR_ID;
  readonly settingsSchema: ConnectorSettingsSchema = VERIFF_KYC_SETTINGS_SCHEMA;
  readonly callbackAuth: ConnectorCallbackHmacAuth = {
    kind: 'hmac',
    algorithm: 'sha256',
    signatureHeader: VERIFF_HEADER_HMAC_SIGNATURE,
    encoding: 'hex',
    secretSettingKey: 'sharedSecretKey',
  };
  readonly countsAttempts = false;

  constructor(
    private readonly veriffClient: VeriffClient,
    private readonly mediaFitter: VeriffMediaFitter,
  ) {}

  validateConfig(_providerConfig: Readonly<Record<string, unknown>>, config: KycConfig): void {
    config.documents.forEach((document, index) => {
      if (
        resolveVeriffMediaContext({
          docSet: document.idDocSetType,
          docType: document.idDocType,
          side: document.idDocSubType,
        }) === undefined
      ) {
        throw new KycConfigInvalidError(
          VERIFF_KYC_CONNECTOR_ID,
          'documents',
          `documents[${index}] (${document.idDocSetType}/${document.idDocSubType ?? 'no side'}) ` +
            'maps to no Veriff media context',
        );
      }
    });
  }

  async submit(
    settings: ResolvedConnectorSettings,
    submission: KycSubmission,
  ): Promise<KycSubmissionReceipt> {
    const credentials = resolveVeriffCredentials(settings);
    const { applicant } = submission;

    const session = await this.veriffClient.createSession(credentials, {
      vendorData: submission.onboardingId,
      person: {
        firstName: applicant.firstName,
        lastName: applicant.lastName,
        dateOfBirth: applicant.dateOfBirth,
      },
      document: this.resolveDocumentPrefill(submission.documents),
    });

    this.logger.log(
      `VERIFF_SESSION_CREATED onboardingId=${submission.onboardingId} sessionId=${session.id}`,
    );

    for (const document of submission.documents) {
      const context = resolveVeriffMediaContext(document);

      if (context === undefined) {
        throw new KycConfigInvalidError(
          VERIFF_KYC_CONNECTOR_ID,
          'documents',
          `document ${document.documentId} maps to no Veriff media context`,
        );
      }

      const fitted = await this.mediaFitter.fit(document);

      await this.veriffClient.uploadMedia(credentials, {
        sessionId: session.id,
        context,
        contentType: fitted.contentType,
        content: fitted.content,
      });
    }

    await this.veriffClient.submitSession(credentials, session.id);

    return { providerReference: session.id };
  }

  /**
   * Veriff posts two shapes to one endpoint: event webhooks (`action` / `feature`, top-level
   * `vendorData`) that decide nothing, and decision webhooks (`verification` object). The id of an
   * event with no usable `vendorData` is empty, which the kernel acknowledges as already applied.
   */
  parseCallback(
    input: ConnectorCallbackMappingInput,
    settings: ResolvedConnectorSettings,
  ): VeriffCallbackEvent {
    const record = this.parseCallbackBody(input.rawBody);

    if (input.headers[VERIFF_HEADER_AUTH_CLIENT] !== resolveVeriffCredentials(settings).apiKey) {
      throw new VeriffCallbackAuthClientMismatchError();
    }

    const verification = record.verification;

    if (
      typeof record.action === 'string' ||
      typeof record.feature === 'string' ||
      !isRecord(verification)
    ) {
      return { onboardingId: optionalString(record.vendorData) ?? '', actionable: false };
    }

    return {
      onboardingId: this.requireNonEmptyString(verification.vendorData, 'verification.vendorData'),
      providerReference: this.requireNonEmptyString(verification.id, 'verification.id'),
      actionable: true,
    };
  }

  buildReconcileEvent(reference: KycPendingReference): VeriffCallbackEvent {
    return { ...reference, actionable: true, origin: 'reconcile' };
  }

  async fetchVerdict(
    settings: ResolvedConnectorSettings,
    event: VeriffCallbackEvent,
  ): Promise<KycVerdict> {
    const sessionId = event.providerReference ?? '';
    const decision = await this.veriffClient.findDecision(
      resolveVeriffCredentials(settings),
      sessionId,
    );

    if (decision === undefined) {
      if (event.origin === 'reconcile') {
        return { kind: 'pending' };
      }

      throw new VeriffDecisionNotAvailableError(sessionId);
    }

    if (decision.vendorData !== undefined && decision.vendorData !== event.onboardingId) {
      throw new VeriffDecisionVendorDataMismatchError(sessionId);
    }

    this.logger.log(
      `VERIFF_DECISION onboardingId=${event.onboardingId} sessionId=${sessionId} ` +
        `status=${decision.status} code=${decision.code ?? 'none'} ` +
        `reasonCode=${decision.reasonCode ?? 'none'}`,
    );

    return this.mapDecision(decision);
  }

  private mapDecision(decision: VeriffDecision): KycVerdict {
    const { reasonCode } = decision;
    const reasonCodes = reasonCode !== undefined ? [String(reasonCode)] : undefined;
    const customerMessage =
      decision.reason !== undefined && decision.reason.trim() !== '' ? decision.reason : undefined;

    switch (decision.status) {
      case VERIFF_DECISION_STATUS_REVIEW:
        return { kind: 'pending' };
      case VERIFF_DECISION_STATUS_APPROVED:
        return {
          kind: 'approved',
          verifiedIdentity: {
            lastName: optionalString(decision.person?.lastName),
            dateOfBirth: optionalString(decision.person?.dateOfBirth),
          },
        };
      case VERIFF_DECISION_STATUS_DECLINED:
        return { kind: 'declined', reasonCodes, customerMessage };
      case VERIFF_DECISION_STATUS_RESUBMISSION_REQUESTED:
        return {
          kind: 'resubmission',
          target: resolveVeriffRetryTarget(reasonCode),
          limitExceeded: reasonCode === VERIFF_REASON_CODE_RESUBMISSION_LIMIT_EXCEEDED,
          reasonCodes,
          customerMessage,
        };
      case VERIFF_DECISION_STATUS_EXPIRED:
      case VERIFF_DECISION_STATUS_ABANDONED:
        return { kind: 'resubmission', target: 'IDENTITY' };
      default:
        throw new VeriffDecisionUnrecognisedStateError(decision.status, decision.code);
    }
  }

  /**
   * Prefills Veriff's document check only when the identity uploads agree on one supported type;
   * a workflow offering a choice of document leaves Veriff to detect it.
   */
  private resolveDocumentPrefill(
    documents: readonly KycDocument[],
  ): { type: VeriffDocumentType; country: string } | undefined {
    const identity = documents.filter((document) => document.docSet === DOC_SET_IDENTITY);
    const types = new Set(identity.map((document) => document.docType));
    const [type] = [...types];

    if (types.size !== 1 || !(VERIFF_DOCUMENT_TYPES as readonly string[]).includes(type)) {
      return undefined;
    }

    return { type: type as VeriffDocumentType, country: identity[0].country };
  }

  private parseCallbackBody(rawBody: Uint8Array): Record<string, unknown> {
    let decoded: string;

    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
    } catch {
      throw new Error('veriff_kyc callback body must be valid UTF-8');
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(decoded);
    } catch {
      throw new Error('veriff_kyc callback body must be valid JSON');
    }

    if (!isRecord(parsed)) {
      throw new Error('veriff_kyc callback JSON body must be an object');
    }

    return parsed;
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`veriff_kyc callback body missing required field "${field}"`);
    }

    return value;
  }
}
