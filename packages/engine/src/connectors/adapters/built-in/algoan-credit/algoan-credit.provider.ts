import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedConnectorSettings } from '../../../connector-settings.service';
import { AlgoanRequestRejectedError } from '../../../errors/algoan-request-rejected.error';
import type {
  ConnectorCallbackHmacAuth,
  ConnectorCallbackMappingInput,
  ConnectorSettingsSchema,
} from '../../../ports/connector-adapter.port';
import type { CreditConfig } from '../credit/credit-config';
import {
  CreditBankDataInvalidError,
  type CreditAssessmentReceipt,
  type CreditBankData,
  type CreditCallbackContext,
  type CreditCallbackEvent,
  type CreditPendingReference,
  type CreditProvider,
  type CreditResult,
  type CreditScore,
  type CreditSubmission,
} from '../credit/credit-provider.port';
import { AlgoanClient } from './algoan-client';
import {
  ALGOAN_CREDIT_CONNECTOR_ID,
  ALGOAN_CREDIT_SETTINGS_SCHEMA,
  ALGOAN_EVENT_ANALYSIS_COMPLETED,
  ALGOAN_EVENT_ANALYSIS_FAILED,
  ALGOAN_HEADER_SIGNATURE,
  parseAlgoanProviderConfig,
  resolveAlgoanCredentials,
} from './algoan-config';
import { ALGOAN_ANALYSIS_STATUS, ALGOAN_CODE_ALREADY_EXISTS } from './algoan-contract';
import { buildAlgoanReport } from './algoan-report';
import { buildSignedMessage, parseSignatureHeader } from './algoan-signature';

const REFERENCE_SEPARATOR = '/';
const CREDIT_SCORE_SCALE = { min: 0, max: 1000 } as const;
const PAYMENT_SCORE_SCALE = { min: 1, max: 10 } as const;
const ACCOUNT_TYPE_CHECKING = 'CHECKING';
const ACCOUNT_USAGE_PERSONAL = 'PERSONAL';
const ANALYSIS_FORMAT = 'ALGOAN';
const ANALYSIS_DATA_ORIGIN = 'OPEN_BANKING';
const PRODUCT_INSIGHTS = 'insights';
const ERROR_CODE_NO_CREDIT_SCORE = 'NO_CREDIT_SCORE';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const sameText = (value: unknown, expected: string): boolean =>
  typeof value === 'string' && value.toUpperCase() === expected;

const buildReference = (customerId: string, analysisId: string): string =>
  `${customerId}${REFERENCE_SEPARATOR}${analysisId}`;

const splitReference = (reference: string | undefined): [string, string] => {
  const [customerId, analysisId, ...rest] = (reference ?? '').split(REFERENCE_SEPARATOR);

  if (!customerId || !analysisId || rest.length > 0) {
    throw new Error(`${ALGOAN_CREDIT_CONNECTOR_ID} provider reference is malformed`);
  }

  return [customerId, analysisId];
};

const invalid = (reason: string): CreditBankDataInvalidError =>
  new CreditBankDataInvalidError(ALGOAN_CREDIT_CONNECTOR_ID, reason);

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Algoan on the credit kernel, API-only: a customer keyed by the onboarding id, one analysis per
 * attempt over the uploaded bank-data document, scores read back once Algoan's webhook says the
 * analysis is done. The webhook body decides nothing: the result always comes from the API.
 */
@Injectable()
export class AlgoanCreditProvider implements CreditProvider {
  private readonly logger = new Logger(AlgoanCreditProvider.name);

  readonly id = ALGOAN_CREDIT_CONNECTOR_ID;
  readonly name = ALGOAN_CREDIT_CONNECTOR_ID;
  readonly settingsSchema: ConnectorSettingsSchema = ALGOAN_CREDIT_SETTINGS_SCHEMA;
  readonly callbackAuth: ConnectorCallbackHmacAuth = {
    kind: 'hmac',
    algorithm: 'sha256',
    signatureHeader: ALGOAN_HEADER_SIGNATURE,
    encoding: 'hex',
    parseSignatureHeader,
    buildSignedMessage,
  };

  constructor(private readonly algoanClient: AlgoanClient) {}

  validateConfig(providerConfig: Readonly<Record<string, unknown>>): void {
    parseAlgoanProviderConfig(providerConfig);
  }

  /**
   * Structural check before any Algoan call, naming Algoan's own field. `config` is the step's
   * declaration, which the kernel passes so the currency is checked here rather than
   * answered by Algoan as `NO_CHECKING_ACCOUNT`.
   */
  validateBankData(bankData: CreditBankData, config: CreditConfig): void {
    const body = this.parseBankData(bankData);
    const { accounts } = body;

    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw invalid('accounts must be a non-empty array');
    }

    accounts.forEach((account: unknown, index) => {
      if (!isRecord(account)) {
        throw invalid(`accounts[${index}] must be an object`);
      }

      if (account.balance === undefined || account.balance === null) {
        throw invalid(`accounts[${index}].balance is required`);
      }

      if (!isNonEmptyString(account.balanceDate)) {
        throw invalid(`accounts[${index}].balanceDate is required`);
      }

      if (!isRecord(account.bank) || !isNonEmptyString(account.bank.name)) {
        throw invalid(`accounts[${index}].bank.name is required`);
      }
    });

    const { currency } = parseAlgoanProviderConfig(config.providerConfig);
    const hasPersonalChecking = accounts.some(
      (account: JsonRecord) =>
        sameText(account.type, ACCOUNT_TYPE_CHECKING) &&
        sameText(account.usage, ACCOUNT_USAGE_PERSONAL) &&
        sameText(account.currency, currency),
    );

    if (!hasPersonalChecking) {
      throw invalid(
        `accounts needs at least one account of type CHECKING, usage PERSONAL and currency ${currency}`,
      );
    }
  }

  /** `config` is the step's declaration; see `validateBankData`. */
  async startAssessment(
    settings: ResolvedConnectorSettings,
    submission: CreditSubmission,
    config: CreditConfig,
  ): Promise<CreditAssessmentReceipt> {
    const credentials = resolveAlgoanCredentials(settings);
    const { accounts } = this.parseBankData(submission.bankData);
    const customer = await this.getOrCreateCustomer(credentials, submission.onboardingId);

    const analysis = await this.algoanClient.createAnalysis(credentials, customer.id, {
      accounts,
      format: ANALYSIS_FORMAT,
      dataOrigin: ANALYSIS_DATA_ORIGIN,
      parameters: {
        disableScores: false,
        disableCreditInsights: !config.products.includes(PRODUCT_INSIGHTS),
      },
    });

    this.logger.log(
      `ALGOAN_ANALYSIS_CREATED onboardingId=${submission.onboardingId} ` +
        `customerId=${customer.id} analysisId=${analysis.id} attempt=${submission.attempt}`,
    );

    return { providerReference: buildReference(customer.id, analysis.id) };
  }

  /**
   * Only `analysis_completed` and `analysis_failed` decide anything; Algoan also sends
   * `bank_details_fetched` and others, whose onboarding id stays empty so the kernel acknowledges
   * them without a lookup.
   */
  async parseCallback(
    input: ConnectorCallbackMappingInput,
    settings: ResolvedConnectorSettings,
  ): Promise<CreditCallbackEvent> {
    const body = this.parseCallbackBody(input.rawBody);
    const eventName = isRecord(body.subscription) ? body.subscription.eventName : undefined;

    if (
      eventName !== ALGOAN_EVENT_ANALYSIS_COMPLETED &&
      eventName !== ALGOAN_EVENT_ANALYSIS_FAILED
    ) {
      return { onboardingId: '', actionable: false };
    }

    const payload = isRecord(body.payload) ? body.payload : {};
    const { customerId, analysisId } = payload;

    if (!isNonEmptyString(customerId) || !isNonEmptyString(analysisId)) {
      throw new Error(
        `${ALGOAN_CREDIT_CONNECTOR_ID} callback payload missing customerId or analysisId`,
      );
    }

    const customer = await this.algoanClient.getCustomer(
      resolveAlgoanCredentials(settings),
      customerId,
    );

    return {
      onboardingId: customer.customIdentifier,
      providerReference: buildReference(customerId, analysisId),
      actionable: true,
    };
  }

  buildReconcileEvent(reference: CreditPendingReference): CreditCallbackEvent {
    return { ...reference, actionable: true };
  }

  async fetchResult(
    settings: ResolvedConnectorSettings,
    event: CreditCallbackEvent,
    context: CreditCallbackContext,
  ): Promise<CreditResult> {
    const credentials = resolveAlgoanCredentials(settings);
    const [customerId, analysisId] = splitReference(event.providerReference);
    const analysis = await this.algoanClient.getAnalysis(credentials, customerId, analysisId);

    if (analysis.status === ALGOAN_ANALYSIS_STATUS.ERROR) {
      const code = analysis.error?.code;

      this.logger.log(
        `ALGOAN_ANALYSIS_ERROR onboardingId=${event.onboardingId} analysisId=${analysisId} ` +
          `code=${code ?? 'none'}`,
      );

      return {
        status: 'failed',
        codes: code === undefined ? [] : [code],
        message: analysis.error?.message,
      };
    }

    if (analysis.status !== ALGOAN_ANALYSIS_STATUS.COMPLETED) {
      return { status: 'pending' };
    }

    const scores = await this.algoanClient.getScores(credentials, customerId, analysisId);
    const score = this.mapScore(scores);

    if (score === undefined) {
      return { status: 'failed', codes: [ERROR_CODE_NO_CREDIT_SCORE] };
    }

    const report = await buildAlgoanReport(
      this.algoanClient,
      credentials,
      { customerId, analysisId, metadata: analysis.metadata, scores },
      context.config,
    );

    return { status: 'scored', score, report: report ?? {} };
  }

  private async getOrCreateCustomer(
    credentials: ReturnType<typeof resolveAlgoanCredentials>,
    onboardingId: string,
  ) {
    try {
      return await this.algoanClient.createCustomer(credentials, onboardingId);
    } catch (error: unknown) {
      if (
        !(error instanceof AlgoanRequestRejectedError) ||
        error.code !== ALGOAN_CODE_ALREADY_EXISTS
      ) {
        throw error;
      }
    }

    const existing = await this.algoanClient.findCustomerByIdentifier(credentials, onboardingId);

    if (existing === undefined) {
      throw new Error(
        `${ALGOAN_CREDIT_CONNECTOR_ID} customer ${onboardingId} exists but could not be found`,
      );
    }

    return existing;
  }

  private mapScore(scores: JsonRecord): CreditScore | undefined {
    const creditScore = isRecord(scores.creditScore) ? scores.creditScore : undefined;
    const value = readNumber(creditScore?.value);

    if (creditScore === undefined || value === undefined) {
      return undefined;
    }

    const paymentScore = isRecord(scores.paymentScore) ? scores.paymentScore : undefined;
    const paymentValue = readNumber(paymentScore?.value);

    return {
      value,
      scale: { ...CREDIT_SCORE_SCALE },
      version: typeof creditScore.version === 'string' ? creditScore.version : undefined,
      indicators: this.mapIndicators(creditScore.indicators),
      ...(paymentValue === undefined
        ? {}
        : {
            secondary: {
              paymentScore: {
                value: paymentValue,
                scale: { ...PAYMENT_SCORE_SCALE },
                version:
                  typeof paymentScore?.version === 'string' ? paymentScore.version : undefined,
              },
            },
          }),
    };
  }

  private mapIndicators(indicators: unknown): Record<string, number> | undefined {
    if (!isRecord(indicators)) {
      return undefined;
    }

    return Object.fromEntries(
      Object.entries(indicators).filter(
        (entry): entry is [string, number] => readNumber(entry[1]) !== undefined,
      ),
    );
  }

  private parseBankData(bankData: CreditBankData): JsonRecord {
    let parsed: unknown;

    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bankData.document));
    } catch {
      throw invalid('document must be UTF-8 JSON');
    }

    if (!isRecord(parsed)) {
      throw invalid('document must be a JSON object');
    }

    return parsed;
  }

  private parseCallbackBody(rawBody: Uint8Array): JsonRecord {
    let parsed: unknown;

    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody));
    } catch {
      throw new Error(`${ALGOAN_CREDIT_CONNECTOR_ID} callback body must be valid UTF-8 JSON`);
    }

    if (!isRecord(parsed)) {
      throw new Error(`${ALGOAN_CREDIT_CONNECTOR_ID} callback JSON body must be an object`);
    }

    return parsed;
  }
}
