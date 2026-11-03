import { Pool } from 'pg';
import { runBounded } from '../concurrency/run-bounded';
import { assertLocalDatabaseHost } from '../database/local-database-guard';
import { MILLISECONDS_PER_DAY } from '../time.constants';

const SPREAD_POOL_SIZE = 4;
const REVIEW_WAITING_FAMILY = 'review-waiting';
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** `parkedAt` is the one timestamp inside `pending_connector`; it ages with the onboarding. */
const SHIFT_ONBOARDING_SQL = `
  update onboardings set
    created_at = created_at - interval '1 millisecond' * $2::double precision,
    updated_at = updated_at - interval '1 millisecond' * $2::double precision,
    completed_at = completed_at - interval '1 millisecond' * $2::double precision,
    pending_connector = case
      when pending_connector->>'parkedAt' is null then pending_connector
      else jsonb_set(
        pending_connector,
        '{parkedAt}',
        to_jsonb(to_char(
          ((pending_connector->>'parkedAt')::timestamptz
            - interval '1 millisecond' * $2::double precision) at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ))
      )
    end
  where id = $1`;

const SHIFT_AUDIT_LOG_SQL = `
  update audit_log
  set occurred_at = occurred_at - interval '1 millisecond' * $2::double precision
  where resource_id = $1`;

/** A seeded onboarding, named by the scenario that produced it. */
export interface SpreadTarget {
  key: string;
  onboardingId: string;
}

export interface SpreadOffset {
  onboardingId: string;
  /** How far the whole onboarding moves back from where the run left it. */
  offsetMs: number;
}

/**
 * Picks, for each onboarding, a whole number of days in `[0, spreadDays - 1]` to move it back, so
 * it starts on a day within the last `spreadDays`. The offset comes from the seed and the scenario
 * key alone, so one seed always spreads one population the same way. The `review-waiting`
 * onboardings instead take evenly falling offsets, oldest first, so the review queue has ageing.
 */
export function planSpread(
  seed: number,
  targets: readonly SpreadTarget[],
  spreadDays: number,
): SpreadOffset[] {
  const waitingKeys = targets
    .map(({ key }) => key)
    .filter((key) => getFamily(key) === REVIEW_WAITING_FAMILY)
    .sort();
  const oldestDay = spreadDays - 1;

  return targets.map(({ key, onboardingId }) => {
    const waitingIndex = waitingKeys.indexOf(key);
    const day =
      waitingIndex === -1
        ? hashToInteger(`${seed}:${key}`) % spreadDays
        : oldestDay - Math.floor((waitingIndex * oldestDay) / waitingKeys.length);

    return { onboardingId, offsetMs: day * MILLISECONDS_PER_DAY };
  });
}

/**
 * Rewrites the timestamps of seeded onboardings in Postgres, because the engine stamps everything
 * with the moment it happened and offers no way to say otherwise. Refuses a host that is not local.
 * Each onboarding moves in one transaction: its own timestamps, its audit rows and the park time
 * must all shift by the same offset or the ordering and gaps the offset promises are lost.
 */
export class TimestampSpreader {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    assertLocalDatabaseHost(databaseUrl);
    this.pool = new Pool({ connectionString: databaseUrl, max: SPREAD_POOL_SIZE });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Throws, naming each onboarding that could not move, after attempting every one. */
  async spread(seed: number, targets: readonly SpreadTarget[], spreadDays: number): Promise<void> {
    const offsets = planSpread(seed, targets, spreadDays);
    const results = await runBounded(offsets, SPREAD_POOL_SIZE, (offset) =>
      this.shiftOnboarding(offset),
    );
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [
            `- ${targets[index].key}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          ]
        : [],
    );

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} onboarding(s) could not be spread:\n${failures.join('\n')}`,
      );
    }
  }

  private async shiftOnboarding({ onboardingId, offsetMs }: SpreadOffset): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('begin');
      await client.query(SHIFT_ONBOARDING_SQL, [onboardingId, offsetMs]);
      await client.query(SHIFT_AUDIT_LOG_SQL, [onboardingId, offsetMs]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

function getFamily(key: string): string {
  return key.replace(/-\d+$/, '');
}

/** FNV-1a over the string's UTF-16 code units, as an unsigned 32-bit integer. */
function hashToInteger(text: string): number {
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), FNV_PRIME);
  }

  return hash >>> 0;
}
