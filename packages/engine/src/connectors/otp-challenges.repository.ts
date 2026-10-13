import { randomUUID } from 'node:crypto';
import type { OtpChannelName } from '@tsh/ddl-schema';
import { EntityManager } from 'typeorm';

export type SaveOtpChallengeInput = {
  onboardingId: string;
  channel: OtpChannelName;
  codeHash: string;
  codeSalt: string;
  expiresAt: Date;
};

export type OtpChallengeRow = {
  id: string;
  onboardingId: string;
  channel: OtpChannelName;
  codeHash: string;
  codeSalt: string;
  expiresAt: Date;
  attempts: number;
  sendCount: number;
};

const RETURNED_COLUMNS = `
  id,
  onboarding_id AS "onboardingId",
  channel,
  code_hash AS "codeHash",
  code_salt AS "codeSalt",
  expires_at AS "expiresAt",
  attempts,
  send_count AS "sendCount"
`;

/**
 * Plain SQL throughout: callers pass the manager of `OtpChallengesConnection`, whose pool carries no
 * entity metadata. `OtpChallengeEntity` still describes the table for the main connection, so the
 * schema and its foreign key stay checked against it.
 */
export class OtpChallengesRepository {
  async find(
    manager: EntityManager,
    onboardingId: string,
    channel: OtpChannelName,
  ): Promise<OtpChallengeRow | null> {
    const rows = await manager.query<OtpChallengeRow[]>(
      `SELECT ${RETURNED_COLUMNS} FROM otp_challenges WHERE onboarding_id = $1 AND channel = $2`,
      [onboardingId, channel],
    );
    return rows[0] ?? null;
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
      RETURNING ${RETURNED_COLUMNS}
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
    const [rows] = await manager.query<[Array<{ attempts: number }>, number]>(
      'UPDATE otp_challenges SET attempts = attempts + 1, updated_at = now() WHERE id = $1 RETURNING attempts',
      [id],
    );
    return rows[0].attempts;
  }

  async remove(manager: EntityManager, id: string): Promise<void> {
    await manager.query('DELETE FROM otp_challenges WHERE id = $1', [id]);
  }
}
