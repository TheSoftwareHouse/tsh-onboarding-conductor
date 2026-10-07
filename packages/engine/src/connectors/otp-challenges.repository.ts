import { randomUUID } from 'node:crypto';
import type { OtpChannelName } from '@tsh/ddl-schema';
import { EntityManager } from 'typeorm';
import { OtpChallengeEntity } from './entity/otp-challenge.entity';

export type SaveOtpChallengeInput = {
  onboardingId: string;
  channel: OtpChannelName;
  codeHash: string;
  codeSalt: string;
  expiresAt: Date;
};

type OtpChallengeRow = {
  id: string;
  onboardingId: string;
  channel: OtpChannelName;
  codeHash: string;
  codeSalt: string;
  expiresAt: Date;
  attempts: number;
  sendCount: number;
};

export class OtpChallengesRepository {
  async find(
    manager: EntityManager,
    onboardingId: string,
    channel: OtpChannelName,
  ): Promise<OtpChallengeEntity | null> {
    return manager.getRepository(OtpChallengeEntity).findOne({ where: { onboardingId, channel } });
  }

  /**
   * Upserts on `(onboarding_id, channel)`: a re-send replaces the hash, salt and expiry, resets
   * `attempts` and increments `send_count`.
   */
  async save(manager: EntityManager, input: SaveOtpChallengeInput): Promise<OtpChallengeRow> {
    const rows = await manager.query<OtpChallengeRow[]>(
      `
      INSERT INTO otp_challenges (id, onboarding_id, channel, code_hash, code_salt, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (onboarding_id, channel) DO UPDATE SET
        code_hash = EXCLUDED.code_hash,
        code_salt = EXCLUDED.code_salt,
        expires_at = EXCLUDED.expires_at,
        attempts = 0,
        send_count = otp_challenges.send_count + 1,
        updated_at = now()
      RETURNING id,
        onboarding_id AS "onboardingId",
        channel,
        code_hash AS "codeHash",
        code_salt AS "codeSalt",
        expires_at AS "expiresAt",
        attempts,
        send_count AS "sendCount"
      `,
      [
        randomUUID(),
        input.onboardingId,
        input.channel,
        input.codeHash,
        input.codeSalt,
        input.expiresAt,
      ],
    );
    return rows[0];
  }

  /** Atomically bumps `attempts` and returns the new value, so concurrent submits cannot overrun. */
  async incrementAttempts(manager: EntityManager, id: string): Promise<number> {
    const result = await manager
      .createQueryBuilder()
      .update(OtpChallengeEntity)
      .set({ attempts: () => 'attempts + 1' })
      .where('id = :id', { id })
      .returning('attempts')
      .execute();
    return (result.raw as Array<{ attempts: number }>)[0].attempts;
  }

  async remove(manager: EntityManager, id: string): Promise<void> {
    await manager.delete(OtpChallengeEntity, { id });
  }
}
