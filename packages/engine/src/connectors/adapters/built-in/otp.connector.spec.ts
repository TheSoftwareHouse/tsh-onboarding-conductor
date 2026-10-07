import { createHash } from 'node:crypto';
import type { NormalizedWorkflowConnectorFallback } from '@tsh/ddl-schema';
import type { DataSource } from 'typeorm';
import { OtpDeclarationInvalidError } from '../../errors/otp-declaration-invalid.error';
import { OtpSendLimitReachedException } from '../../errors/otp-send-limit-reached.exception';
import type { OtpChallengeEntity } from '../../entity/otp-challenge.entity';
import type { OtpChallengesRepository } from '../../otp-challenges.repository';
import type { ConnectorExecutionInput } from '../../ports/connector-adapter.port';
import type { OtpChannel } from '../../ports/otp-channel.port';
import { OtpConnector } from './otp.connector';

const ONBOARDING_ID = 'onb-1';
const RECIPIENT = 'user@example.com';
const NOW = new Date('2026-01-01T12:00:00.000Z');
const MINUTE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;
const SALT = 'ab'.repeat(16);

class TestOtpConnector extends OtpConnector {
  protected override now(): Date {
    return NOW;
  }
}

const hashOf = (code: string): string =>
  createHash('sha256').update(`${SALT}${code}`).digest('hex');

const challengeRow = (overrides: Partial<OtpChallengeEntity> = {}): OtpChallengeEntity =>
  ({
    id: 'challenge-1',
    onboardingId: ONBOARDING_ID,
    channel: 'email',
    codeHash: hashOf('123456'),
    codeSalt: SALT,
    expiresAt: new Date(NOW.getTime() + MINUTE_MS),
    attempts: 0,
    sendCount: 1,
    ...overrides,
  }) as OtpChallengeEntity;

const setup = () => {
  const manager = { name: 'manager' };
  const repository = {
    find: jest.fn<Promise<OtpChallengeEntity | null>, unknown[]>().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue({ id: 'challenge-1', attempts: 0, sendCount: 1 }),
    incrementAttempts: jest.fn().mockResolvedValue(1),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const emailChannel: OtpChannel = {
    channel: 'email',
    settingsFields: [],
    send: jest.fn().mockResolvedValue(undefined),
  };
  const smsChannel: OtpChannel = {
    channel: 'sms',
    settingsFields: [{ key: 'twilioAuthToken', secret: true, required: false }],
    send: jest.fn().mockResolvedValue(undefined),
  };
  const connector = new TestOtpConnector(
    { manager } as unknown as DataSource,
    repository as unknown as OtpChallengesRepository,
    [smsChannel, emailChannel],
  );
  return { connector, repository, manager, emailChannel, smsChannel };
};

const input = (
  operation: string,
  payload: Record<string, unknown>,
  channel = 'email',
): ConnectorExecutionInput => ({
  declaration: { order: 0, config: { operation, channel } },
  execution: { onboardingId: ONBOARDING_ID, stepName: 'verify' },
  context: {},
  payload,
  payloadFieldSources: { recipient: 'email', code: 'verificationCode' },
});

const send = () => input('send', { recipient: RECIPIENT });
const check = (code: string) => input('check', { recipient: RECIPIENT, code });

describe('OtpConnector', () => {
  it('identifies itself and flattens the channels settings into its schema', () => {
    const { connector, smsChannel, emailChannel } = setup();

    expect(connector).toMatchObject({ id: 'otp', name: 'otp', type: 'otp_verification' });
    expect(connector.settingsSchema.fields).toEqual([
      ...smsChannel.settingsFields,
      ...emailChannel.settingsFields,
    ]);
  });

  describe('send', () => {
    it('stores only a salted hash, delivers the plaintext and accepts', async () => {
      const { connector, repository, manager, emailChannel } = setup();

      const result = await connector.execute(send());

      expect(result.isAccepted()).toBe(true);
      const saved = repository.save.mock.calls[0];
      expect(saved[0]).toBe(manager);
      const stored = saved[1];
      const code = (emailChannel.send as jest.Mock).mock.calls[0][1] as string;
      expect(emailChannel.send).toHaveBeenCalledWith(RECIPIENT, code);
      expect(code).toMatch(/^\d{6}$/);
      expect(stored.codeHash).toBe(
        createHash('sha256').update(`${stored.codeSalt}${code}`).digest('hex'),
      );
      expect(stored.codeHash).toHaveLength(64);
      expect(stored.expiresAt).toEqual(new Date(NOW.getTime() + 10 * MINUTE_MS));
      expect(JSON.stringify(stored)).not.toContain(code);
      expect(stored).toMatchObject({ onboardingId: ONBOARDING_ID, channel: 'email' });
    });

    it('uses a fresh salt per send (a resend resets attempts but keeps send_count in the upsert)', async () => {
      const { connector, repository } = setup();

      await connector.execute(send());
      await connector.execute(send());

      const [first, second] = repository.save.mock.calls.map((call) => call[1]);
      expect(first.codeSalt).not.toBe(second.codeSalt);
      expect(first).not.toHaveProperty('attempts');
      expect(first).not.toHaveProperty('sendCount');
    });

    it('delivers through the channel the declaration names', async () => {
      const { connector, smsChannel, emailChannel } = setup();

      await connector.execute(input('send', { recipient: '+48123456789' }, 'sms'));

      expect(smsChannel.send).toHaveBeenCalledTimes(1);
      expect(emailChannel.send).not.toHaveBeenCalled();
    });

    it('allows the last permitted send', async () => {
      const { connector, repository } = setup();
      repository.find.mockResolvedValue(challengeRow({ sendCount: MAX_SENDS - 1 }));

      expect((await connector.execute(send())).isAccepted()).toBe(true);
    });

    it('refuses the send past MAX_SENDS before saving or delivering', async () => {
      const { connector, repository, emailChannel } = setup();
      repository.find.mockResolvedValue(challengeRow({ sendCount: MAX_SENDS }));

      await expect(connector.execute(send())).rejects.toBeInstanceOf(OtpSendLimitReachedException);
      expect(repository.save).not.toHaveBeenCalled();
      expect(emailChannel.send).not.toHaveBeenCalled();
    });

    it('propagates a delivery failure', async () => {
      const { connector, emailChannel } = setup();
      (emailChannel.send as jest.Mock).mockRejectedValue(new Error('delivery failed'));

      await expect(connector.execute(send())).rejects.toThrow('delivery failed');
    });

    it('returns invalid without a recipient', async () => {
      const { connector } = setup();

      expect((await connector.execute(input('send', {}))).isInvalid()).toBe(true);
    });
  });

  describe('check', () => {
    it('rejects CHALLENGE_NOT_FOUND without a challenge', async () => {
      const { connector } = setup();

      const result = await connector.execute(check('123456'));

      expect(result.reason).toBe('CHALLENGE_NOT_FOUND');
    });

    it('rejects CHALLENGE_EXPIRED once expiresAt has passed', async () => {
      const { connector, repository } = setup();
      repository.find.mockResolvedValue(challengeRow({ expiresAt: NOW }));

      expect((await connector.execute(check('123456'))).reason).toBe('CHALLENGE_EXPIRED');
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('accepts the right code and deletes the row', async () => {
      const { connector, repository, manager } = setup();
      repository.find.mockResolvedValue(challengeRow());

      const result = await connector.execute(check('123456'));

      expect(result.isAccepted()).toBe(true);
      expect(repository.remove).toHaveBeenCalledWith(manager, 'challenge-1');
    });

    it('returns retryable invalid data keyed by the code field on a wrong code', async () => {
      const { connector, repository } = setup();
      repository.find.mockResolvedValue(challengeRow());
      repository.incrementAttempts.mockResolvedValue(MAX_ATTEMPTS - 1);

      const result = await connector.execute(check('000000'));

      expect(result.isInvalidData()).toBe(true);
      expect(result.errors).toEqual({ verificationCode: ['INVALID'] });
      expect(result.metadata).toEqual({ retryableInvalidData: true });
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('rejects ATTEMPTS_EXHAUSTED when the wrong code spends the budget, keeping the row', async () => {
      const { connector, repository } = setup();
      repository.find.mockResolvedValue(challengeRow({ attempts: MAX_ATTEMPTS - 1 }));
      repository.incrementAttempts.mockResolvedValue(MAX_ATTEMPTS);

      expect((await connector.execute(check('000000'))).reason).toBe('ATTEMPTS_EXHAUSTED');
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('rejects ATTEMPTS_EXHAUSTED for a row whose budget is already spent, even with the right code', async () => {
      const { connector, repository } = setup();
      repository.find.mockResolvedValue(challengeRow({ attempts: MAX_ATTEMPTS }));

      expect((await connector.execute(check('123456'))).reason).toBe('ATTEMPTS_EXHAUSTED');
      expect(repository.incrementAttempts).not.toHaveBeenCalled();
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('returns invalid without a code or a recipient', async () => {
      const { connector } = setup();

      expect((await connector.execute(input('check', { recipient: RECIPIENT }))).isInvalid()).toBe(
        true,
      );
      expect((await connector.execute(input('check', { code: '123456' }))).isInvalid()).toBe(true);
    });
  });

  describe('validateDeclaration', () => {
    const declaration = (config: Record<string, unknown>) =>
      ({ name: 'otp', id: 'otp', config }) as unknown as NormalizedWorkflowConnectorFallback;

    it('accepts a known operation and channel', () => {
      const { connector } = setup();

      expect(() =>
        connector.validateDeclaration(declaration({ operation: 'check', channel: 'sms' })),
      ).not.toThrow();
    });

    it.each([
      ['an unknown operation', { operation: 'start', channel: 'sms' }],
      ['a missing operation', { channel: 'sms' }],
      ['an unknown channel', { operation: 'send', channel: 'voice' }],
      ['a missing channel', { operation: 'send' }],
    ])('refuses %s', (_name, config) => {
      const { connector } = setup();

      expect(() => connector.validateDeclaration(declaration(config))).toThrow(
        OtpDeclarationInvalidError,
      );
    });
  });
});
