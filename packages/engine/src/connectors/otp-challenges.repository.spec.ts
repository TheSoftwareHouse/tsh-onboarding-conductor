import { EntityManager } from 'typeorm';
import { OtpChallengeEntity } from './entity/otp-challenge.entity';
import { OtpChallengesRepository } from './otp-challenges.repository';

describe('OtpChallengesRepository', () => {
  const createHarness = () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const execute = jest.fn().mockResolvedValue({ raw: [{ attempts: 3 }] });
    const returning = jest.fn().mockReturnValue({ execute });
    const where = jest.fn().mockReturnValue({ returning });
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const manager = {
      query: jest.fn().mockResolvedValue([{ id: 'challenge-1', sendCount: 2 }]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      getRepository: jest.fn().mockReturnValue({ findOne }),
      createQueryBuilder: jest.fn().mockReturnValue({ update }),
    } as unknown as EntityManager;

    return { sut: new OtpChallengesRepository(), manager, findOne, update, set, where, returning };
  };

  it('finds a challenge by onboarding and channel', async () => {
    const { sut, manager, findOne } = createHarness();

    await sut.find(manager, 'onboarding-1', 'sms');

    expect(manager.getRepository).toHaveBeenCalledWith(OtpChallengeEntity);
    expect(findOne).toHaveBeenCalledWith({
      where: { onboardingId: 'onboarding-1', channel: 'sms' },
    });
  });

  it('upserts on (onboarding_id, channel), resetting attempts and incrementing send_count', async () => {
    const { sut, manager } = createHarness();
    const expiresAt = new Date('2026-01-01T00:10:00.000Z');

    const saved = await sut.save(manager, {
      onboardingId: 'onboarding-1',
      channel: 'sms',
      codeHash: 'h'.repeat(64),
      codeSalt: 's'.repeat(32),
      expiresAt,
    });

    const [sql, parameters] = (manager.query as jest.Mock).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO otp_challenges');
    expect(sql).toContain('ON CONFLICT (onboarding_id, channel) DO UPDATE');
    expect(sql).toContain('attempts = 0');
    expect(sql).toContain('send_count = otp_challenges.send_count + 1');
    expect(sql).toContain('code_hash = EXCLUDED.code_hash');
    expect(parameters.slice(1)).toEqual([
      'onboarding-1',
      'sms',
      'h'.repeat(64),
      's'.repeat(32),
      expiresAt,
    ]);
    expect(saved).toEqual({ id: 'challenge-1', sendCount: 2 });
  });

  it('increments attempts with one atomic UPDATE ... RETURNING', async () => {
    const { sut, manager, update, set, where, returning } = createHarness();

    const attempts = await sut.incrementAttempts(manager, 'challenge-1');

    expect(update).toHaveBeenCalledWith(OtpChallengeEntity);
    const assignment = (set.mock.calls[0] as [{ attempts: () => string }])[0];
    expect(assignment.attempts()).toBe('attempts + 1');
    expect(where).toHaveBeenCalledWith('id = :id', { id: 'challenge-1' });
    expect(returning).toHaveBeenCalledWith('attempts');
    expect(attempts).toBe(3);
  });

  it('removes a challenge by id', async () => {
    const { sut, manager } = createHarness();

    await sut.remove(manager, 'challenge-1');

    expect(manager.delete).toHaveBeenCalledWith(OtpChallengeEntity, { id: 'challenge-1' });
  });
});
