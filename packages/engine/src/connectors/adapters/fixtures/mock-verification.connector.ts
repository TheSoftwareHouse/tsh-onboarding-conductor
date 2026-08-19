import { Injectable } from '@nestjs/common';
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

/**
 * Operation names accepted for each step of a verification. The mock's own wording comes
 * first; the rest are the spellings of the providers it stands in for, so a workflow written
 * for a real provider needs no edit when CONNECTOR_MOCKS points its type here.
 */
const CHALLENGE_OPERATIONS = ['challenge', 'startVerification', 'generateCode'];
const VERIFY_OPERATIONS = ['verify', 'checkVerification', 'verifyCode'];

/** Provider services keep these out of the workflow, so the mock picks usual values. */
const CODE_LENGTH = 6;
const TTL_SECONDS = 600;
const MAX_ATTEMPTS = 5;

type PendingDetail = Readonly<{ operation: 'challenge' | 'verify'; code?: string }>;

type ChallengeOutcome =
  | Readonly<{ status: 'accepted' }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'invalid-data'; errors: Readonly<Record<string, readonly string[]>> }>
  | Readonly<{
      status: 'rejected';
      reason: 'ATTEMPTS_EXHAUSTED' | 'CHALLENGE_EXPIRED' | 'CHALLENGE_NOT_FOUND';
    }>;

/**
 * One-time-code verification with no provider behind it: challenge a recipient, then check
 * the code. Both drive modes are implemented because the choice belongs to the workflow — a
 * declaration with `async: false` gets its verdict from `execute`, while `async: true` makes
 * `execute` an initiation the engine parks until a callback reports. Standing in for a
 * provider that has no callbacks simply leaves the async half unused.
 */
abstract class OtpVerificationMockConnector implements ConnectorAdapter {
  readonly supportsAsyncCallback = true;
  readonly callbackAuth: ConnectorCallbackUnsignedAuth = {
    kind: 'none',
    justification:
      'Fixture with no upstream provider to share a signing secret with; production ingress additionally requires naming it in CONNECTOR_CALLBACK_UNSIGNED_TYPES, which no deployment should do.',
  };

  private readonly challenges: OtpChallengeStore;
  private readonly callbacks = new ProviderCallbackStore<PendingDetail>();

  protected constructor(
    readonly name: string,
    readonly type: string,
  ) {
    this.challenges = new OtpChallengeStore(type);
  }

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const operation = this.resolveOperation(input.declaration.config.operation);
    const recipient = this.text(input.payload.recipient);
    const { onboardingId } = input.execution;

    if (!operation || !recipient) {
      return ConnectorExecutionResult.invalid();
    }

    if (operation === 'challenge') {
      const outcome = this.challenges.generateCode(
        onboardingId,
        { recipient },
        { codeLength: CODE_LENGTH, ttlSeconds: TTL_SECONDS },
      );

      if (outcome.status === 'accepted' && input.declaration.async === true) {
        // The provider took the request and confirms the dispatch on its own time.
        this.callbacks.record({
          onboardingId,
          connectorOrder: input.declaration.order,
          detail: { operation: 'challenge' },
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
        detail: { operation: 'verify', code },
      });

      return ConnectorExecutionResult.accepted();
    }

    return this.toResult(
      this.challenges.verifyCode(onboardingId, { code }, { maxAttempts: MAX_ATTEMPTS }),
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

    if (initiation.detail.operation === 'challenge' || status === 'accepted') {
      return ConnectorExecutionResult.accepted();
    }

    // A verification the provider was asked to check: replay it against the stored challenge,
    // using the code the callback carries when it states one.
    const code = this.text(payload.code) ?? initiation.detail.code;

    if (!code) {
      throw new Error('code must be a non-empty string');
    }

    return this.toResult(
      this.challenges.verifyCode(initiation.onboardingId, { code }, { maxAttempts: MAX_ATTEMPTS }),
    );
  }

  private resolveOperation(value: unknown): 'challenge' | 'verify' | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    if (CHALLENGE_OPERATIONS.includes(value)) {
      return 'challenge';
    }

    return VERIFY_OPERATIONS.includes(value) ? 'verify' : undefined;
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

  __peekCodeForTests(onboardingId: string): string | undefined {
    return this.challenges.peekCodeForTests(onboardingId);
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

@Injectable()
export class MockPhoneVerificationConnector extends OtpVerificationMockConnector {
  constructor() {
    super('mock_phone_verification', 'mock_phone_verification');
  }
}

@Injectable()
export class MockEmailVerificationConnector extends OtpVerificationMockConnector {
  constructor() {
    super('mock_email_verification', 'mock_email_verification');
  }
}
