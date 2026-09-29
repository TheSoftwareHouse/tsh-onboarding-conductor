import { AddOnboardingsInProgressVersionIndex0028 } from './migrations/0028_add_onboardings_in_progress_version_index';

// Sits beside the migrations directory rather than in it: the migrations glob loads every file
// there as a migration, and a spec is not one.

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/** Runs `up` or `down`, recording every statement issued, each normalized to single-line SQL. */
const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
  const query = jest.fn<Promise<unknown>, [string]>(async () => undefined);

  await new AddOnboardingsInProgressVersionIndex0028()[direction]({ query } as never);

  return query.mock.calls.map(([sql]) => normalize(sql));
};

describe('0028_add_onboardings_in_progress_version_index', () => {
  it('is named for TypeORM to run it in sequence', () => {
    expect(AddOnboardingsInProgressVersionIndex0028.name).toBe(
      'AddOnboardingsInProgressVersionIndex0028',
    );
    expect(new AddOnboardingsInProgressVersionIndex0028().name).toMatch(
      /^0028_add_onboardings_in_progress_version_index_\d{13}$/,
    );
  });

  it('creates the partial index over unfinished onboardings', async () => {
    expect(await runMigration('up')).toEqual([
      'CREATE INDEX idx_onboardings_in_progress_version ON onboardings (workflow_version_id) WHERE completed_at IS NULL',
    ]);
  });

  it('drops the index', async () => {
    expect(await runMigration('down')).toEqual([
      'DROP INDEX IF EXISTS idx_onboardings_in_progress_version',
    ]);
  });
});
