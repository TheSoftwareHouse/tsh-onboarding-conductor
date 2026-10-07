import { createHash } from 'node:crypto';
import type { NormalizedWorkflowConnectorFallback, OtpChannelName } from '@tsh/ddl-schema';
import type { DataSource } from 'typeorm';
import { OtpDeclarationInvalidError } from '../../../errors/otp-declaration-invalid.error';
import { OtpSendLimitReachedException } from '../../../errors/otp-send-limit-reached.exception';
import type { OtpChallengeEntity } from '../../../entity/otp-challenge.entity';
import type { OtpChallengesRepository } from '../../../otp-challenges.repository';
import type { ConnectorExecutionInput } from '../../../ports/connector-adapter.port';
import { BaseOtpConnector } from './base-otp.connector';

const ONBOARDING_ID = 'onb-1';
const RECIPIENT = 'user@example.com';
const NOW = new Date('2026-01-01T12:00:00.000Z');
const MINUTE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;
const SALT = 'ab'.repeat(16);

/** The smallest provider the base class allows: a delivery the spec observes. */
class MockDeliveryOtpConnector extends BaseOtpConnector {
  readonly name: string;
  readonly delivered = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);

  constructor(
    dataSource: DataSource,
    challenges: OtpChallengesRepository,
    readonly id: string,
    readonly channel: OtpChannelName,
  ) {
    super(dataSource, challenges);
    this.name = id;
  }

  protected deliver(recipient: string, code: string): Promise<void> {
    return this.delivered(recipient, code);
  }

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
  const create = (id: string, channel: OtpChannelName) =>
    new MockDeliveryOtpConnector(
      { manager } as unknown as DataSource,
      repository as unknown as OtpChallengesRepository,
      id,
      channel,
    );
  const connector = create('mock_email_otp', 'email');
  return { connector, repository, manager, create };
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

describe('BaseOtpConnector', () => {
  it('fixes the capability to otp_verification whatever the subclass names itself', () => {
    const { connector } = setup();

    expect(connector).toMatchObject({
      id: 'mock_email_otp',
      name: 'mock_email_otp',
      type: 'otp_verification',
      channel: 'email',
    });
  });

  describe('send', () => {
    it('stores only a salted hash, delivers the plaintext and accepts', async () => {
      const { connector, repository, manager } = setup();

      const result = await connector.execute(send());

      expect(result.isAccepted()).toBe(true);
      const saved = repository.save.mock.calls[0];
      expect(saved[0]).toBe(manager);
      const stored = saved[1];
      const code = connector.delivered.mock.calls[0][1] as string;
      expect(connector.delivered).toHaveBeenCalledWith(RECIPIENT, code);
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

    it('returns invalid, delivering nothing, for a declaration of another channel', async () => {
      const { connector, repository } = setup();

      const result = await connector.execute(input('send', { recipient: '+48123456789' }, 'sms'));

      expect(result.isInvalid()).toBe(true);
      expect(connector.delivered).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('allows the last permitted send', async () => {
      const { connector, repository } = setup();
      repository.find.mockResolvedValue(challengeRow({ sendCount: MAX_SENDS - 1 }));

      expect((await connector.execute(send())).isAccepted()).toBe(true);
    });

    it('refuses the send past MAX_SENDS before saving or delivering', async () => {
      const { connector, repository } = setup();
      repository.find.mockResolvedValue(challengeRow({ sendCount: MAX_SENDS }));

      await expect(connector.execute(send())).rejects.toBeInstanceOf(OtpSendLimitReachedException);
      expect(repository.save).not.toHaveBeenCalled();
      expect(connector.delivered).not.toHaveBeenCalled();
    });

    it('propagates a delivery failure without storing the code or spending a send', async () => {
      const { connector, repository } = setup();
      connector.delivered.mockRejectedValue(new Error('delivery failed'));

      await expect(connector.execute(send())).rejects.toThrow('delivery failed');
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('stores the code only after the channel delivered it', async () => {
      const { connector, repository } = setup();

      await connector.execute(send());

      const [delivered] = connector.delivered.mock.invocationCallOrder;
      const [saved] = repository.save.mock.invocationCallOrder;
      expect(delivered).toBeLessThan(saved);
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

  it('checks a code that another connector of the same channel delivered', async () => {
    const { connector: fallback, create, repository } = setup();
    const primary = create('mock_primary_email_otp', 'email');

    await fallback.execute(send());
    const code = fallback.delivered.mock.calls[0][1];
    const stored = repository.save.mock.calls[0][1];
    repository.find.mockResolvedValue(
      challengeRow({ codeHash: stored.codeHash, codeSalt: stored.codeSalt }),
    );

    expect((await primary.execute(check(code))).isAccepted()).toBe(true);
    expect(repository.find).toHaveBeenLastCalledWith(expect.anything(), ONBOARDING_ID, 'email');
  });

  describe('validateDeclaration', () => {
    const declaration = (config: Record<string, unknown>) =>
      ({
        name: 'otp',
        id: 'mock_email_otp',
        config,
      }) as unknown as NormalizedWorkflowConnectorFallback;

    it('accepts a known operation on its own channel', () => {
      const { connector } = setup();

      expect(() =>
        connector.validateDeclaration(declaration({ operation: 'check', channel: 'email' })),
      ).not.toThrow();
    });

    it.each([
      ['an unknown operation', { operation: 'start', channel: 'email' }],
      ['a missing operation', { channel: 'email' }],
      ['another channel', { operation: 'send', channel: 'sms' }],
      ['an unknown channel', { operation: 'send', channel: 'voice' }],
      ['a missing channel', { operation: 'send' }],
    ])('refuses %s, naming the connector', (_name, config) => {
      const { connector } = setup();

      expect(() => connector.validateDeclaration(declaration(config))).toThrow(
        OtpDeclarationInvalidError,
      );
      expect(() => connector.validateDeclaration(declaration(config))).toThrow(/mock_email_otp/);
    });
  });
});
