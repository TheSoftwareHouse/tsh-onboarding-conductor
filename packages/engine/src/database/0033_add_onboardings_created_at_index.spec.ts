import { AddOnboardingsCreatedAtIndex0033 } from './migrations/0033_add_onboardings_created_at_index';

// Sits beside the migrations directory rather than in it: the migrations glob loads every file
// there as a migration, and a spec is not one.

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/** Runs `up` or `down`, recording every statement issued, each normalized to single-line SQL. */
const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
  const query = jest.fn<Promise<unknown>, [string]>(async () => undefined);

  await new AddOnboardingsCreatedAtIndex0033()[direction]({ query } as never);

  return query.mock.calls.map(([sql]) => normalize(sql));
};

describe('0033_add_onboardings_created_at_index', () => {
  it('is named for TypeORM to run it in sequence', () => {
    expect(AddOnboardingsCreatedAtIndex0033.name).toBe('AddOnboardingsCreatedAtIndex0033');
    expect(new AddOnboardingsCreatedAtIndex0033().name).toMatch(
      /^0033_add_onboardings_created_at_index_\d{13}$/,
    );
  });

  it('creates the keyset index over created_at and id', async () => {
    expect(await runMigration('up')).toEqual([
      'CREATE INDEX IF NOT EXISTS idx_onboardings_created_at_id ON onboardings (created_at DESC, id DESC)',
    ]);
  });

  it('drops the index', async () => {
    expect(await runMigration('down')).toEqual([
      'DROP INDEX IF EXISTS idx_onboardings_created_at_id',
    ]);
  });
});
