import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  OTP_CONFIG_KEYS,
  OTP_OPERATIONS,
  type NormalizedWorkflowConnectorFallback,
  type OtpChannelName,
  type OtpOperation,
} from '@tsh/ddl-schema';
import { OtpChallengesConnection } from '../../../otp-challenges.connection';
import { OtpChallengesRepository } from '../../../otp-challenges.repository';
import { OtpDeclarationInvalidError } from '../../../errors/otp-declaration-invalid.error';
import type {
  ConnectorAdapter,
  ConnectorExecutionInput,
} from '../../../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../../ports/connector-execution-result';

const OTP_CODE_LENGTH = 6;
const OTP_DIGIT_RADIX = 10;
const OTP_TTL_MINUTES = 10;
const MS_PER_MINUTE = 60_000;
const OTP_TTL_MS = OTP_TTL_MINUTES * MS_PER_MINUTE;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS = 5;
const OTP_SALT_BYTES = 16;
const DEFAULT_CODE_FIELD = 'code';
const DEFAULT_RECIPIENT_FIELD = 'recipient';

/** What a provider reports back from `deliver` when it did not throw. */
export const OTP_DELIVERY_OUTCOMES = {
  delivered: 'delivered',
  /** The provider refused the address or number itself: the person has to supply another. */
  invalidRecipient: 'invalid_recipient',
} as const;

export type OtpDeliveryOutcome = (typeof OTP_DELIVERY_OUTCOMES)[keyof typeof OTP_DELIVERY_OUTCOMES];

const isOtpOperation = (value: unknown): value is OtpOperation =>
  typeof value === 'string' && Object.values<string>(OTP_OPERATIONS).includes(value);

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/**
 * What every one-time-code connector shares: the engine generates, stores (salted hash only),
 * limits and checks the code, and a subclass only delivers it. A provider is one subclass naming
 * its `id`, its `channel` and — when it reads credentials — its `settingsSchema`, and implementing
 * `deliver`. It is then an ordinary `otp_verification` connector: a workflow binds it by id, swaps
 * it by editing that id, and lists it in a `fallback` chain behind another provider.
 *
 * Challenges are keyed by onboarding and channel, not by connector, so the check step's connector
 * finds a code that a fallback provider delivered on the send step.
 *
 * Challenges are written outside the submit's transaction, on purpose: a wrong code ends the submit
 * in a rollback (retryable invalid data), and the spent attempt must survive it or the attempt
 * budget would never run out. They go through `OtpChallengesConnection`'s own pool, never the main
 * one, because the submit already holds a main-pool connection while this runs.
 */
export abstract class BaseOtpConnector implements ConnectorAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  /** The one channel this connector delivers over; a declaration naming another fails at startup. */
  abstract readonly channel: OtpChannelName;
  readonly type = 'otp_verification' as const;

  protected constructor(
    private readonly connection: OtpChallengesConnection,
    private readonly challenges: OtpChallengesRepository,
  ) {}

  /**
   * Delivers `code` to `recipient` and reports `delivered`, or `invalidRecipient` when the provider
   * refuses the address or number itself — the submit then fails as invalid data on the recipient's
   * field. Anything else throws: `OtpDeliveryFailedException` when the provider cannot be reached or
   * answers with an error, `ConnectorNotConfiguredException` for an operator's configuration gap.
   * Neither outcome but `delivered` stores anything, so the declaration's error handler may retry or
   * fall back. Never store, log or return the code.
   */
  protected abstract deliver(recipient: string, code: string): Promise<OtpDeliveryOutcome>;

  validateDeclaration(declaration: NormalizedWorkflowConnectorFallback): void {
    const config = declaration.config ?? {};
    const operation = config[OTP_CONFIG_KEYS.operation];
    if (!isOtpOperation(operation)) {
      throw new OtpDeclarationInvalidError(this.id, 'operation', operation);
    }
    const channel = config[OTP_CONFIG_KEYS.channel];
    if (channel !== this.channel) {
      throw new OtpDeclarationInvalidError(this.id, 'channel', channel);
    }
  }

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const operation = input.declaration.config[OTP_CONFIG_KEYS.operation];
    const channel = input.declaration.config[OTP_CONFIG_KEYS.channel];
    const recipient = nonEmptyString(input.payload.recipient);
    if (!isOtpOperation(operation) || channel !== this.channel || !recipient) {
      return ConnectorExecutionResult.invalid();
    }

    if (operation === OTP_OPERATIONS.send) {
      const recipientField = input.payloadFieldSources.recipient ?? DEFAULT_RECIPIENT_FIELD;
      return this.send(input.execution.onboardingId, recipient, recipientField);
    }

    const code = nonEmptyString(input.payload.code);
    if (!code) {
      return ConnectorExecutionResult.invalid();
    }
    const codeField = input.payloadFieldSources.code ?? DEFAULT_CODE_FIELD;
    return this.check(input.execution.onboardingId, code, codeField);
  }

  /** Overridable so a spec can move time without fake timers. */
  protected now(): Date {
    return new Date();
  }

  /**
   * The send that would exceed OTP_MAX_SENDS is rejected with `ATTEMPTS_EXHAUSTED` before the
   * upsert, so it neither rewrites the live code nor delivers anything, and the workflow routes the
   * onboarding to its refusal rather than leaving it on a step no submit can leave. The code is
   * stored only once `deliver` has returned, so a failed delivery spends no send and leaves the
   * live code valid.
   */
  private async send(
    onboardingId: string,
    recipient: string,
    recipientField: string,
  ): Promise<ConnectorExecutionResult> {
    const manager = await this.connection.getManager();
    const existing = await this.challenges.find(manager, onboardingId, this.channel);
    if (existing && existing.sendCount >= OTP_MAX_SENDS) {
      return ConnectorExecutionResult.rejected('ATTEMPTS_EXHAUSTED');
    }

    const code = this.generateCode();
    if ((await this.deliver(recipient, code)) === OTP_DELIVERY_OUTCOMES.invalidRecipient) {
      return ConnectorExecutionResult.invalidData(
        { [recipientField]: ['INVALID'] },
        { [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true },
      );
    }

    const codeSalt = randomBytes(OTP_SALT_BYTES).toString('hex');
    await this.challenges.save(manager, {
      onboardingId,
      channel: this.channel,
      codeHash: this.hash(codeSalt, code),
      codeSalt,
      expiresAt: new Date(this.now().getTime() + OTP_TTL_MS),
    });
    return ConnectorExecutionResult.accepted();
  }

  private async check(
    onboardingId: string,
    code: string,
    codeField: string,
  ): Promise<ConnectorExecutionResult> {
    const manager = await this.connection.getManager();
    const challenge = await this.challenges.find(manager, onboardingId, this.channel);
    if (!challenge) {
      return ConnectorExecutionResult.rejected('CHALLENGE_NOT_FOUND');
    }
    if (challenge.expiresAt.getTime() <= this.now().getTime()) {
      return ConnectorExecutionResult.rejected('CHALLENGE_EXPIRED');
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      return ConnectorExecutionResult.rejected('ATTEMPTS_EXHAUSTED');
    }

    if (this.matches(challenge.codeSalt, challenge.codeHash, code)) {
      await this.challenges.remove(manager, challenge.id);
      return ConnectorExecutionResult.accepted();
    }

    const attempts = await this.challenges.incrementAttempts(manager, challenge.id);
    if (attempts >= OTP_MAX_ATTEMPTS) {
      return ConnectorExecutionResult.rejected('ATTEMPTS_EXHAUSTED');
    }
    return ConnectorExecutionResult.invalidData(
      { [codeField]: ['INVALID'] },
      { [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true },
    );
  }

  private generateCode(): string {
    return Array.from({ length: OTP_CODE_LENGTH }, () => randomInt(OTP_DIGIT_RADIX)).join('');
  }

  private hash(salt: string, code: string): string {
    return createHash('sha256').update(`${salt}${code}`).digest('hex');
  }

  private matches(salt: string, expectedHash: string, code: string): boolean {
    const actual = Buffer.from(this.hash(salt, code), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
