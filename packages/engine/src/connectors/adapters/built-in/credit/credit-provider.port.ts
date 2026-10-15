import type {
  ConnectorCallbackAuth,
  ConnectorCallbackMappingInput,
  ConnectorSettingsSchema,
} from '../../../ports/connector-adapter.port';
import type { ResolvedConnectorSettings } from '../../../connector-settings.service';
import type { CreditConfig } from './credit-config';

/** The applicant roles the workflow bound, when it bound any. */
export type CreditApplicant = Readonly<{ firstName?: string; lastName?: string; email?: string }>;

/** The bank-data document as read from object storage; its format is opaque to the kernel. */
export type CreditBankData = Readonly<{
  format: string;
  document: Uint8Array;
  contentType: string;
}>;

/** Everything a provider needs to start one assessment. */
export type CreditSubmission = Readonly<{
  onboardingId: string;
  /** 1-based attempt number; one provider analysis per attempt. */
  attempt: number;
  applicant?: CreditApplicant;
  bankData: CreditBankData;
}>;

/** Algoan: `${customerId}/${analysisId}`. */
export type CreditAssessmentReceipt = Readonly<{ providerReference: string }>;

export type CreditScore = Readonly<{
  value: number;
  scale: { min: number; max: number };
  version?: string;
  indicators?: Readonly<Record<string, number>>;
  /** Further scores the provider reports beside the primary one, such as a payment score. */
  secondary?: Readonly<
    Record<string, { value: number; scale: { min: number; max: number }; version?: string }>
  >;
}>;

/** Provider-shaped, client-visible, size-capped (`CREDIT_REPORT_MAX_BYTES`). */
export type CreditReport = Readonly<Record<string, unknown>>;

export type CreditResult =
  | { status: 'pending' }
  | { status: 'failed'; codes: string[]; message?: string }
  | { status: 'scored'; score: CreditScore; report: CreditReport };

/**
 * Thrown by `CreditProvider.validateBankData` before any provider call when the document is not
 * in a format the provider accepts. The kernel answers it as the step's own field error.
 */
export class CreditBankDataInvalidError extends Error {
  constructor(
    readonly providerId: string,
    readonly reason: string,
  ) {
    super(`${providerId} cannot assess the bank-data document: ${reason}`);
    this.name = 'CreditBankDataInvalidError';
  }
}

/**
 * A provider webhook, reduced to what the kernel acts on. `actionable: false` re-parks the step
 * without reading a result.
 */
export interface CreditCallbackEvent {
  readonly onboardingId: string;
  readonly providerReference?: string;
  readonly actionable: boolean;
  readonly hint?: string;
}

/** The attempt an onboarding is parked on, as the park records it. */
export type CreditPendingReference = Readonly<{ onboardingId: string; providerReference: string }>;

export type CreditCallbackContext = Readonly<{
  config: CreditConfig;
  providerConfig: Readonly<Record<string, unknown>>;
  onboardingContext: Readonly<Record<string, unknown>>;
}>;

/**
 * The wire half of a credit connector: one implementation per provider, driven by
 * `CreditConnector`. `TEvent` lets a provider carry more of its webhook from `parseCallback` into
 * `fetchResult`.
 */
export interface CreditProvider<TEvent extends CreditCallbackEvent = CreditCallbackEvent> {
  readonly id: string;
  readonly name: string;
  readonly settingsSchema: ConnectorSettingsSchema;
  readonly callbackAuth: ConnectorCallbackAuth;
  /** Startup check of the keys no kernel rule consumed. */
  validateConfig(providerConfig: Readonly<Record<string, unknown>>, config: CreditConfig): void;
  /** Validates the bank-data document for this provider's accepted formats; throws `CreditBankDataInvalidError`. */
  validateBankData(bankData: CreditBankData, config: CreditConfig): void;
  /** Creates or reuses the applicant and starts one assessment; returns the reference to park on. */
  startAssessment(
    settings: ResolvedConnectorSettings,
    submission: CreditSubmission,
    config: CreditConfig,
  ): Promise<CreditAssessmentReceipt>;
  parseCallback(
    input: ConnectorCallbackMappingInput,
    settings: ResolvedConnectorSettings,
  ): TEvent | Promise<TEvent>;
  buildReconcileEvent(reference: CreditPendingReference): TEvent;
  /** Reads the assessment back; `pending` while the provider is still computing. */
  fetchResult(
    settings: ResolvedConnectorSettings,
    event: TEvent,
    context: CreditCallbackContext,
  ): Promise<CreditResult>;
}
