import { AddOnboardingsPendingConnector0030 } from './migrations/0030_add_onboardings_pending_connector';

// Sits beside the migrations directory rather than in it: the migrations glob loads every file
// there as a migration, and a spec is not one.

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/** Runs `up` or `down`, recording every statement issued, each normalized to single-line SQL. */
const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
  const query = jest.fn<Promise<unknown>, [string]>(async () => undefined);

  await new AddOnboardingsPendingConnector0030()[direction]({ query } as never);

  return query.mock.calls.map(([sql]) => normalize(sql));
};

describe('0030_add_onboardings_pending_connector', () => {
  it('is named for TypeORM to run it in sequence', () => {
    expect(AddOnboardingsPendingConnector0030.name).toBe('AddOnboardingsPendingConnector0030');
    expect(new AddOnboardingsPendingConnector0030().name).toMatch(
      /^0030_add_onboardings_pending_connector_\d{13}$/,
    );
  });

  it('adds the nullable jsonb column with an object check', async () => {
    expect(await runMigration('up')).toEqual([
      "ALTER TABLE onboardings ADD COLUMN pending_connector JSONB NULL, ADD CONSTRAINT chk_onboardings_pending_connector_object CHECK (pending_connector IS NULL OR jsonb_typeof(pending_connector) = 'object')",
    ]);
  });

  it('drops the check and the column', async () => {
    expect(await runMigration('down')).toEqual([
      'ALTER TABLE onboardings DROP CONSTRAINT IF EXISTS chk_onboardings_pending_connector_object, DROP COLUMN IF EXISTS pending_connector',
    ]);
  });
});
