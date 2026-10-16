import { EntityManager } from 'typeorm';
import { OtpChallengesRepository } from './otp-challenges.repository';

describe('OtpChallengesRepository', () => {
  const createHarness = (queryResult: unknown = []) => {
    const query = jest.fn().mockResolvedValue(queryResult);
    const manager = { query } as unknown as EntityManager;

    return { sut: new OtpChallengesRepository(), manager, query };
  };

  const callOf = (query: jest.Mock): [string, unknown[]] =>
    query.mock.calls[0] as [string, unknown[]];

  it('finds a challenge by onboarding and channel', async () => {
    const row = { id: 'challenge-1', sendCount: 1 };
    const { sut, manager, query } = createHarness([row]);

    const found = await sut.find(manager, 'onboarding-1', 'sms');

    const [sql, parameters] = callOf(query);
    expect(sql).toContain('FROM otp_challenges WHERE onboarding_id = $1 AND channel = $2');
    expect(sql).toContain('send_count AS "sendCount"');
    expect(parameters).toEqual(['onboarding-1', 'sms']);
    expect(found).toBe(row);
  });

  it('finds nothing when no challenge is stored', async () => {
    const { sut, manager } = createHarness([]);

    expect(await sut.find(manager, 'onboarding-1', 'sms')).toBeNull();
  });

  it('upserts on (onboarding_id, channel), resetting attempts and incrementing send_count', async () => {
    const { sut, manager, query } = createHarness([{ id: 'challenge-1', sendCount: 2 }]);
    const expiresAt = new Date('2026-01-01T00:10:00.000Z');

    const saved = await sut.save(manager, {
      onboardingId: 'onboarding-1',
      channel: 'sms',
      codeHash: 'h'.repeat(64),
      codeSalt: 's'.repeat(32),
      expiresAt,
    });

    const [sql, parameters] = callOf(query);
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
    const { sut, manager, query } = createHarness([[{ attempts: 3 }], 1]);

    const attempts = await sut.incrementAttempts(manager, 'challenge-1');

    const [sql, parameters] = callOf(query);
    expect(sql).toContain('SET attempts = attempts + 1');
    expect(sql).toContain('RETURNING attempts');
    expect(parameters).toEqual(['challenge-1']);
    expect(attempts).toBe(3);
  });

  it('removes a challenge by id', async () => {
    const { sut, manager, query } = createHarness();

    await sut.remove(manager, 'challenge-1');

    expect(query).toHaveBeenCalledWith('DELETE FROM otp_challenges WHERE id = $1', ['challenge-1']);
  });
});
