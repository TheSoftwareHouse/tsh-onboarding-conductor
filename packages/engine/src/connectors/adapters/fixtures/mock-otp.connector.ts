import { Injectable } from '@nestjs/common';
import {
  OTP_CHANNELS,
  OTP_CONFIG_KEYS,
  OTP_OPERATIONS,
  type OtpChannelName,
  type OtpOperation,
} from '@tsh/ddl-schema';
import type {
  ConnectorAdapter,
  ConnectorCallbackMappingInput,
  ConnectorCallbackUnsignedAuth,
  ConnectorExecutionInput,
} from '../../ports/connector-adapter.port';
import {
  type ConnectorCallbackResult,
  type ConnectorRejectionReason,
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';
import { OtpChallengeStore } from './support/otp-challenge.store';
import { ProviderCallbackStore, type ProviderInitiation } from './support/provider-callback.store';

/** Provider services keep these out of the workflow, so the mock picks usual values. */
const CODE_LENGTH = 6;
const TTL_SECONDS = 600;
const MAX_ATTEMPTS = 5;

type PendingDetail = Readonly<{
  operation: OtpOperation;
  channel: OtpChannelName;
  codeField: string;
  code?: string;
}>;

const DEFAULT_CODE_FIELD = 'code';

type ChallengeOutcome =
  | Readonly<{ status: 'accepted' }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'invalid-data'; errors: Readonly<Record<string, readonly string[]>> }>
  | Readonly<{
      status: 'rejected';
      reason: 'ATTEMPTS_EXHAUSTED' | 'CHALLENGE_EXPIRED' | 'CHALLENGE_NOT_FOUND';
    }>;

/**
 * One-time-code verification with no provider behind it: send a code to a recipient, then check
 * the code. Both drive modes are implemented because the choice belongs to the workflow — a
 * declaration with `async: false` gets its verdict from `execute`, while `async: true` makes
 * `execute` an initiation the engine parks until a callback reports. Standing in for a
 * provider that has no callbacks simply leaves the async half unused.
 */
@Injectable()
export class MockOtpConnector implements ConnectorAdapter {
  readonly id = 'mock_otp';
  readonly name = 'mock_otp';
  readonly type = 'otp_verification';
  readonly supportsAsyncCallback = true;
  readonly callbackAuth: ConnectorCallbackUnsignedAuth = {
    kind: 'none',
    justification:
      'Fixture with no upstream provider to share a signing secret with; production ingress additionally requires naming it in CONNECTOR_CALLBACK_UNSIGNED_TYPES, which no deployment should do.',
  };

  private readonly challenges = new OtpChallengeStore('mock_otp');
  private readonly callbacks = new ProviderCallbackStore<PendingDetail>();

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const operation = this.resolveOperation(input.declaration.config[OTP_CONFIG_KEYS.operation]);
    const channel = this.resolveChannel(input.declaration.config[OTP_CONFIG_KEYS.channel]);
    const recipient = this.text(input.payload.recipient);
    const { onboardingId } = input.execution;

    if (!operation || !channel || !recipient) {
      return ConnectorExecutionResult.invalid();
    }

    const codeField = input.payloadFieldSources.code ?? DEFAULT_CODE_FIELD;

    if (operation === OTP_OPERATIONS.send) {
      const outcome = this.challenges.generateCode(
        onboardingId,
        { recipient },
        { channel, codeLength: CODE_LENGTH, ttlSeconds: TTL_SECONDS },
      );

      if (outcome.status === 'accepted' && input.declaration.async === true) {
        // The provider took the request and confirms the dispatch on its own time.
        this.callbacks.record({
          onboardingId,
          connectorOrder: input.declaration.order,
          detail: { operation, channel, codeField },
        });
      }

      return this.toResult(outcome);
    }

    const code = this.text(input.payload.code);

    if (!code) {
      return ConnectorExecutionResult.invalid();
    }

    if (input.declaration.async === true) {
      // The code goes to the provider now; the verdict comes back as a callback.
      this.callbacks.record({
        onboardingId,
        connectorOrder: input.declaration.order,
        detail: { operation, channel, codeField, code },
      });

      return ConnectorExecutionResult.accepted();
    }

    return this.toResult(
      this.challenges.verifyCode(
        onboardingId,
        { code },
        { channel, codeField, maxAttempts: MAX_ATTEMPTS },
      ),
    );
  }

  async mapCallbackResult(input: ConnectorCallbackMappingInput): Promise<ConnectorCallbackResult> {
    const payload = this.callbacks.parseCallback(input.rawBody);
    const initiation = this.callbacks.requireInitiation(payload);

    return {
      onboardingId: initiation.onboardingId,
      submittedData: this.callbacks.requireSubmittedData(payload.submittedData),
      resolvedConnector: { connectorOrder: initiation.connectorOrder },
      result: this.callbackResult(payload, initiation),
    };
  }

  private callbackResult(
    payload: Readonly<Record<string, unknown>>,
    initiation: ProviderInitiation<PendingDetail>,
  ): ConnectorExecutionResult {
    const status = payload.status;

    if (status === 'rejected') {
      return ConnectorExecutionResult.rejected(this.reason(payload.reason) ?? 'CONNECTOR_REJECTED');
    }

    if (status !== undefined && status !== 'accepted') {
      throw new Error('status must be one of accepted, rejected');
    }

    if (initiation.detail.operation === OTP_OPERATIONS.send || status === 'accepted') {
      return ConnectorExecutionResult.accepted();
    }

    // A verification the provider was asked to check: replay it against the stored challenge,
    // using the code the callback carries when it states one.
    const code = this.text(payload.code) ?? initiation.detail.code;

    if (!code) {
      throw new Error('code must be a non-empty string');
    }

    return this.toResult(
      this.challenges.verifyCode(
        initiation.onboardingId,
        { code },
        {
          channel: initiation.detail.channel,
          codeField: initiation.detail.codeField,
          maxAttempts: MAX_ATTEMPTS,
        },
      ),
    );
  }

  private resolveOperation(value: unknown): OtpOperation | undefined {
    return value === OTP_OPERATIONS.send || value === OTP_OPERATIONS.check ? value : undefined;
  }

  private resolveChannel(value: unknown): OtpChannelName | undefined {
    return OTP_CHANNELS.find((channel) => channel === value);
  }

  private text(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  }

  private reason(value: unknown): ConnectorRejectionReason | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (
      value === 'ATTEMPTS_EXHAUSTED' ||
      value === 'CHALLENGE_EXPIRED' ||
      value === 'CHALLENGE_NOT_FOUND' ||
      value === 'CONNECTOR_REJECTED'
    ) {
      return value;
    }

    throw new Error('reason must be a valid ConnectorRejectionReason');
  }

  private toResult(outcome: ChallengeOutcome): ConnectorExecutionResult {
    if (outcome.status === 'accepted') {
      return ConnectorExecutionResult.accepted();
    }

    if (outcome.status === 'invalid') {
      return ConnectorExecutionResult.invalid();
    }

    if (outcome.status === 'invalid-data') {
      return ConnectorExecutionResult.invalidData(outcome.errors, {
        [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
      });
    }

    return ConnectorExecutionResult.rejected(outcome.reason);
  }

  __peekCodeForTests(onboardingId: string, channel?: OtpChannelName): string | undefined {
    return this.challenges.peekCodeForTests(onboardingId, channel);
  }

  __peekInitiationForTests(onboardingId: string): ProviderInitiation<PendingDetail> | undefined {
    return this.callbacks.peekLatest(onboardingId);
  }

  __buildProviderCallbackForTests(payload: Readonly<Record<string, unknown>>) {
    return this.callbacks.buildCallback(payload);
  }

  __setNowForTests(nowProvider: () => number): void {
    this.challenges.setNowProviderForTests(nowProvider);
  }

  __resetForTests(): void {
    this.challenges.resetForTests();
    this.callbacks.reset();
  }
}
