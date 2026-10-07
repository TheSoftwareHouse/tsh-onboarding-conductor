import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  OTP_CONFIG_KEYS,
  OTP_OPERATIONS,
  type NormalizedWorkflowConnectorFallback,
  type OtpChannelName,
  type OtpOperation,
} from '@tsh/ddl-schema';
import { DataSource } from 'typeorm';
import { OtpChallengesRepository } from '../../otp-challenges.repository';
import { OtpDeclarationInvalidError } from '../../errors/otp-declaration-invalid.error';
import { OtpSendLimitReachedException } from '../../errors/otp-send-limit-reached.exception';
import type {
  ConnectorAdapter,
  ConnectorExecutionInput,
  ConnectorSettingsSchema,
} from '../../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';
import {
  OTP_CHANNEL_COLLECTION,
  type OtpChannel,
  type OtpChannelCollection,
} from '../../ports/otp-channel.port';
import { OTP_CONNECTOR_ID } from './otp/otp.constants';

const OTP_CODE_LENGTH = 6;
const OTP_DIGIT_RADIX = 10;
const OTP_TTL_MINUTES = 10;
const MS_PER_MINUTE = 60_000;
const OTP_TTL_MS = OTP_TTL_MINUTES * MS_PER_MINUTE;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS = 5;
const OTP_SALT_BYTES = 16;
const DEFAULT_CODE_FIELD = 'code';

const isOtpOperation = (value: unknown): value is OtpOperation =>
  typeof value === 'string' && Object.values<string>(OTP_OPERATIONS).includes(value);

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/**
 * The engine-owned one-time-code connector: it generates, stores (salted hash only) and checks the
 * code, and hands delivery to the channel named by the declaration's `config.channel`.
 */
@Injectable()
export class OtpConnector implements ConnectorAdapter {
  readonly name = OTP_CONNECTOR_ID;
  readonly id = OTP_CONNECTOR_ID;
  readonly type = 'otp_verification' as const;
  readonly settingsSchema: ConnectorSettingsSchema;

  constructor(
    private readonly dataSource: DataSource,
    private readonly challenges: OtpChallengesRepository,
    @Inject(OTP_CHANNEL_COLLECTION) private readonly channels: OtpChannelCollection,
  ) {
    this.settingsSchema = { fields: channels.flatMap((channel) => channel.settingsFields) };
  }

  validateDeclaration(declaration: NormalizedWorkflowConnectorFallback): void {
    const config = declaration.config ?? {};
    const operation = config[OTP_CONFIG_KEYS.operation];
    if (!isOtpOperation(operation)) {
      throw new OtpDeclarationInvalidError('operation', operation);
    }
    const channel = config[OTP_CONFIG_KEYS.channel];
    if (typeof channel !== 'string' || !this.findChannel(channel)) {
      throw new OtpDeclarationInvalidError('channel', channel);
    }
  }

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const operation = input.declaration.config[OTP_CONFIG_KEYS.operation];
    const channel = this.findChannel(input.declaration.config[OTP_CONFIG_KEYS.channel]);
    const recipient = nonEmptyString(input.payload.recipient);
    if (!isOtpOperation(operation) || !channel || !recipient) {
      return ConnectorExecutionResult.invalid();
    }

    if (operation === OTP_OPERATIONS.send) {
      return this.send(input.execution.onboardingId, channel, recipient);
    }

    const code = nonEmptyString(input.payload.code);
    if (!code) {
      return ConnectorExecutionResult.invalid();
    }
    const codeField = input.payloadFieldSources.code ?? DEFAULT_CODE_FIELD;
    return this.check(input.execution.onboardingId, channel.channel, code, codeField);
  }

  /** Overridable so a spec can move time without fake timers. */
  protected now(): Date {
    return new Date();
  }

  private findChannel(name: unknown): OtpChannel | undefined {
    return this.channels.find((channel) => channel.channel === name);
  }

  /**
   * The send that would exceed OTP_MAX_SENDS is refused before the upsert, so a refused send
   * neither rewrites the live code nor delivers anything.
   */
  private async send(
    onboardingId: string,
    channel: OtpChannel,
    recipient: string,
  ): Promise<ConnectorExecutionResult> {
    const manager = this.dataSource.manager;
    const existing = await this.challenges.find(manager, onboardingId, channel.channel);
    if (existing && existing.sendCount >= OTP_MAX_SENDS) {
      throw new OtpSendLimitReachedException();
    }

    const code = this.generateCode();
    const codeSalt = randomBytes(OTP_SALT_BYTES).toString('hex');
    await this.challenges.save(manager, {
      onboardingId,
      channel: channel.channel,
      codeHash: this.hash(codeSalt, code),
      codeSalt,
      expiresAt: new Date(this.now().getTime() + OTP_TTL_MS),
    });

    await channel.send(recipient, code);
    return ConnectorExecutionResult.accepted();
  }

  private async check(
    onboardingId: string,
    channel: OtpChannelName,
    code: string,
    codeField: string,
  ): Promise<ConnectorExecutionResult> {
    const manager = this.dataSource.manager;
    const challenge = await this.challenges.find(manager, onboardingId, channel);
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
