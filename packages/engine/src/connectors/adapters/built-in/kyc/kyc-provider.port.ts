import type {
  ConnectorCallbackHmacAuth,
  ConnectorCallbackMappingInput,
  ConnectorSettingsSchema,
} from '../../../ports/connector-adapter.port';
import type { ResolvedConnectorSettings } from '../../../connector-settings.service';
import type { KycRetryTarget } from './kyc-contract';
import type { KycConfig } from './kyc-config';

/** The eight applicant roles as the workflow collected them; countries are ISO alpha-2. */
export type KycApplicant = Readonly<{
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  country: string;
  street?: string;
  town?: string;
  postCode?: string;
}>;

/** One captured document, already read from object storage. `country` is ISO alpha-2. */
export type KycDocument = Readonly<{
  documentId: string;
  docSet: string;
  docType: string;
  side?: string;
  country: string;
  contentType: string;
  content: Buffer;
}>;

/** Everything a provider needs to open a verification. The kernel builds it before any provider call. */
export type KycSubmission = Readonly<{
  onboardingId: string;
  sourceKey: string;
  providerConfig: Readonly<Record<string, unknown>>;
  applicant: KycApplicant;
  documents: readonly KycDocument[];
  questionnaire?: Readonly<{
    pathMap: Readonly<Record<string, string>>;
    answers: Readonly<Record<string, string | boolean | undefined>>;
  }>;
}>;

export type KycSubmissionReceipt = Readonly<{ providerReference: string }>;

/**
 * A provider webhook, reduced to what the kernel acts on. `actionable: false` re-parks the step
 * without reading a verdict; `hint` is the provider's own classification, passed back to it
 * untouched. A provider that needs more of the webhook later extends this type.
 */
export interface KycCallbackEvent {
  readonly onboardingId: string;
  readonly providerReference?: string;
  readonly actionable: boolean;
  readonly hint?: string;
}

export type KycCallbackContext = Readonly<{
  config: KycConfig;
  providerConfig: Readonly<Record<string, unknown>>;
  onboardingContext: Readonly<Record<string, unknown>>;
}>;

/** What the provider says about the applicant, to be checked against what they declared. */
export type KycVerifiedIdentity = Readonly<{ lastName?: string; dateOfBirth?: string }>;

/**
 * The vocabulary a provider maps its own states onto. A state the provider cannot map is thrown,
 * never defaulted, so the callback answers 5xx and the provider redelivers.
 */
export type KycVerdict =
  /** Not decided yet; the provider calls again. */
  | Readonly<{ kind: 'pending' }>
  /** Human review for a provider-side reason. `detail` carries counts only, never content. */
  | Readonly<{
      kind: 'needs_review';
      reason: string;
      detail?: Readonly<Record<string, number>>;
    }>
  | Readonly<{ kind: 'approved'; verifiedIdentity: KycVerifiedIdentity | undefined }>
  | Readonly<{
      kind: 'declined';
      reasonCodes?: readonly string[];
      customerMessage?: string;
    }>
  | Readonly<{
      kind: 'resubmission';
      target: KycRetryTarget;
      /** The provider's own attempt count; absent when the kernel must count. */
      attemptCount?: number;
      limitExceeded?: boolean;
      reasonCodes?: readonly string[];
      customerMessage?: string;
    }>;

/**
 * The wire half of a KYC connector: one implementation per provider, driven by `KycConnector`.
 * `TEvent` lets a provider carry more of its webhook from `parseCallback` into `fetchVerdict`.
 */
export interface KycProvider<TEvent extends KycCallbackEvent = KycCallbackEvent> {
  readonly id: string;
  readonly name: string;
  readonly settingsSchema: ConnectorSettingsSchema;
  readonly callbackAuth: ConnectorCallbackHmacAuth;
  /** True when the provider reports attempts itself; false makes the kernel count resubmissions. */
  readonly countsAttempts: boolean;
  /**
   * Startup check of the keys no kernel rule consumed. `config` is the whole parsed declaration,
   * for a provider whose rules also depend on the document list or the questionnaire.
   */
  validateConfig(providerConfig: Readonly<Record<string, unknown>>, config: KycConfig): void;
  submit(
    settings: ResolvedConnectorSettings,
    submission: KycSubmission,
  ): Promise<KycSubmissionReceipt>;
  parseCallback(
    input: ConnectorCallbackMappingInput,
    settings: ResolvedConnectorSettings,
  ): TEvent | Promise<TEvent>;
  fetchVerdict(
    settings: ResolvedConnectorSettings,
    event: TEvent,
    context: KycCallbackContext,
  ): Promise<KycVerdict>;
  onRetry?(
    settings: ResolvedConnectorSettings,
    event: TEvent,
    target: KycRetryTarget,
  ): Promise<void>;
}
