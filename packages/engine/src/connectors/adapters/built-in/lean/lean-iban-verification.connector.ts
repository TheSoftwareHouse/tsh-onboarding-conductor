import { Injectable, Logger } from '@nestjs/common';
import type { NormalizedWorkflowConnectorFallback } from '@tsh/ddl-schema';
import { ConnectorSettingsService } from '../../../connector-settings.service';
import { LeanUnavailableException } from '../../../errors/lean-unavailable.exception';
import type {
  ConnectorAdapter,
  ConnectorExecutionInput,
} from '../../../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../../ports/connector-execution-result';
import { LEAN_IBAN_SETTINGS } from './lean-config';
import { LeanClient } from './lean-client';
import {
  LEAN_ACCOUNT_STATUS_ACTIVE,
  LEAN_ERROR_STATUS_INVALID_PARAMETERS,
  LEAN_IBAN_VERIFICATION_CONNECTOR_ID,
  LEAN_REJECTION_IBAN_NOT_VERIFIABLE,
  LEAN_REJECTION_IBAN_OWNERSHIP_NOT_VERIFIED,
  LEAN_RESULT_STATUS_OK,
} from './lean-contract';

const PAYLOAD_KEY_IBAN = 'iban';
const PAYLOAD_KEY_NATIONAL_ID = 'nationalId';
const REQUIRED_PAYLOAD_KEYS = [PAYLOAD_KEY_IBAN, PAYLOAD_KEY_NATIONAL_ID] as const;

/** Lean names the offending parameter only in the prose of a 400; the IBAN is the usual one. */
const NATIONAL_ID_MESSAGE_PATTERN = /national|identification/i;

const INVALID_PARAMETERS_MESSAGE = 'LEAN_INVALID_PARAMETERS';

/** Metadata key carrying which Lean outcome a `CONNECTOR_REJECTED` result stands for. */
const LEAN_REASON_METADATA_KEY = 'leanReason';

/**
 * Confirms that a Saudi IBAN belongs to the applicant's national ID through Lean's account
 * verification (Confirmation of Payee), synchronously inside the step. Every refusal is
 * `CONNECTOR_REJECTED`, the engine's only general-purpose refusal reason; which Lean outcome it
 * was travels as `leanReason` in the result metadata, so it reaches the audit record. Nothing
 * Lean returns is stored in onboarding state, and nothing about the IBAN or national ID is logged.
 */
@Injectable()
export class LeanIbanVerificationConnector implements ConnectorAdapter {
  readonly name = LEAN_IBAN_VERIFICATION_CONNECTOR_ID;
  readonly id = LEAN_IBAN_VERIFICATION_CONNECTOR_ID;
  readonly type = 'bank_verification' as const;
  readonly settingsSchema = LEAN_IBAN_SETTINGS;

  private readonly logger = new Logger(LeanIbanVerificationConnector.name);

  constructor(
    private readonly leanClient: LeanClient,
    private readonly connectorSettingsService: ConnectorSettingsService,
  ) {}

  validateDeclaration(declaration: NormalizedWorkflowConnectorFallback): void {
    for (const key of REQUIRED_PAYLOAD_KEYS) {
      if (!(key in declaration.fieldMapping)) {
        throw new Error(`fieldMapping must map "${key}" for connector id=${this.id}`);
      }
    }
  }

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const iban = input.payload[PAYLOAD_KEY_IBAN];
    const nationalId = input.payload[PAYLOAD_KEY_NATIONAL_ID];

    if (typeof iban !== 'string' || typeof nationalId !== 'string') {
      return ConnectorExecutionResult.invalid();
    }

    const settings = await this.connectorSettingsService.resolve(this);
    const result = await this.leanClient.verifyAccount(
      { clientId: settings.get('clientId'), clientSecret: settings.get('clientSecret') },
      { iban, nationalId },
    );

    if (result.kind === 'error') {
      if (result.body.status === LEAN_ERROR_STATUS_INVALID_PARAMETERS) {
        const payloadKey = NATIONAL_ID_MESSAGE_PATTERN.test(result.body.message)
          ? PAYLOAD_KEY_NATIONAL_ID
          : PAYLOAD_KEY_IBAN;

        return ConnectorExecutionResult.invalidData(
          { [input.payloadFieldSources[payloadKey] ?? payloadKey]: [INVALID_PARAMETERS_MESSAGE] },
          { [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true },
        );
      }

      // Any other 4xx (forbidden, rate limited) is a fault of the integration, not of the data.
      this.logger.warn(
        `LEAN_IBAN_VERIFICATION_ERROR onboardingId=${input.execution.onboardingId} ` +
          `httpStatus=${result.httpStatus} status=${result.body.status}`,
      );
      throw new LeanUnavailableException();
    }

    const { status, verifications } = result.body;

    if (verifications?.account_ownership_verified === false) {
      return this.reject(input, LEAN_REJECTION_IBAN_OWNERSHIP_NOT_VERIFIED);
    }

    if (
      status !== LEAN_RESULT_STATUS_OK ||
      verifications?.account_ownership_verified !== true ||
      verifications.account_status !== LEAN_ACCOUNT_STATUS_ACTIVE
    ) {
      return this.reject(input, LEAN_REJECTION_IBAN_NOT_VERIFIABLE);
    }

    return ConnectorExecutionResult.accepted();
  }

  private reject(input: ConnectorExecutionInput, leanReason: string): ConnectorExecutionResult {
    this.logger.log(
      `LEAN_IBAN_VERIFICATION_REJECTED onboardingId=${input.execution.onboardingId} ` +
        `leanReason=${leanReason}`,
    );

    return ConnectorExecutionResult.rejected('CONNECTOR_REJECTED', {
      [LEAN_REASON_METADATA_KEY]: leanReason,
    });
  }
}
