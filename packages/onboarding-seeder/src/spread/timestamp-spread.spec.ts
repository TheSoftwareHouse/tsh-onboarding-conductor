import { Pool } from 'pg';
import { MILLISECONDS_PER_DAY } from '../time.constants';
import { TimestampSpreader, planSpread, type SpreadTarget } from './timestamp-spread';

jest.mock('pg', () => ({ Pool: jest.fn() }));

const LOCAL_URL = 'postgres://user:secret@localhost:5436/orchestrator';
const SPREAD_DAYS = 90;

const TARGETS: SpreadTarget[] = [
  'approved-01',
  'approved-02',
  'review-waiting-01',
  'review-waiting-02',
  'review-waiting-03',
  'review-waiting-04',
  'parked-awaiting-01',
  'duplicate-applicant-01',
].map((key) => ({ key, onboardingId: `id-${key}` }));

describe('planSpread', () => {
  it('gives the same offsets for the same seed and different ones for another', () => {
    const first = planSpread(42, TARGETS, SPREAD_DAYS);

    expect(planSpread(42, TARGETS, SPREAD_DAYS)).toEqual(first);
    expect(planSpread(43, TARGETS, SPREAD_DAYS)).not.toEqual(first);
  });

  it('derives an offset from the seed and the key alone, whatever else was seeded', () => {
    const [approved] = planSpread(42, [TARGETS[0]], SPREAD_DAYS);
    const [sameApproved] = planSpread(42, TARGETS, SPREAD_DAYS);

    expect(sameApproved).toEqual(approved);
  });

  it('moves each onboarding back a whole number of days inside the window', () => {
    for (const { offsetMs } of planSpread(42, TARGETS, SPREAD_DAYS)) {
      expect(offsetMs % MILLISECONDS_PER_DAY).toBe(0);
      expect(offsetMs).toBeGreaterThanOrEqual(0);
      expect(offsetMs).toBeLessThan(SPREAD_DAYS * MILLISECONDS_PER_DAY);
    }
  });

  it('ages the review queue: the first review-waiting onboardings are the oldest', () => {
    const waiting = planSpread(42, TARGETS, SPREAD_DAYS)
      .filter(({ onboardingId }) => onboardingId.startsWith('id-review-waiting'))
      .map(({ offsetMs }) => offsetMs / MILLISECONDS_PER_DAY);

    expect(waiting[0]).toBe(SPREAD_DAYS - 1);
    expect([...waiting].sort((a, b) => b - a)).toEqual(waiting);
    expect(new Set(waiting).size).toBe(waiting.length);
  });

  it('keeps a one-day window at no offset', () => {
    expect(planSpread(42, TARGETS, 1).every(({ offsetMs }) => offsetMs === 0)).toBe(true);
  });
});

describe('TimestampSpreader', () => {
  let statements: Array<{ sql: string; params?: unknown[] }>;
  let failOn: string | undefined;

  beforeEach(() => {
    statements = [];
    failOn = undefined;
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        statements.push({ sql: sql.trim().split(/\s+/).slice(0, 2).join(' '), params });
        if (failOn !== undefined && sql.includes(failOn)) {
          throw new Error('boom');
        }
      }),
      release: jest.fn(),
    };
    (Pool as unknown as jest.Mock).mockImplementation(() => ({
      connect: jest.fn(async () => client),
      end: jest.fn(),
    }));
  });

  it('refuses a host that is not local and never opens a pool', () => {
    expect(() => new TimestampSpreader('postgres://u:p@db.example.org/x')).toThrow(
      'db.example.org',
    );
    expect(Pool).not.toHaveBeenCalled();
  });

  it('moves an onboarding and its audit rows by one offset, in one transaction', async () => {
    const spreader = new TimestampSpreader(LOCAL_URL);
    const [target] = TARGETS;
    const [{ offsetMs }] = planSpread(42, [target], SPREAD_DAYS);

    await spreader.spread(42, [target], SPREAD_DAYS);

    expect(statements.map(({ sql }) => sql)).toEqual([
      'begin',
      'update onboardings',
      'update audit_log',
      'commit',
    ]);
    expect(statements[1].params).toEqual([target.onboardingId, offsetMs]);
    expect(statements[2].params).toEqual([target.onboardingId, offsetMs]);
  });

  it('rolls an onboarding back when a write fails, and names it', async () => {
    failOn = 'update audit_log';
    const spreader = new TimestampSpreader(LOCAL_URL);

    await expect(spreader.spread(42, [TARGETS[0]], SPREAD_DAYS)).rejects.toThrow(
      'approved-01: boom',
    );
    expect(statements.map(({ sql }) => sql)).toEqual([
      'begin',
      'update onboardings',
      'update audit_log',
      'rollback',
    ]);
  });
});
