import { AddOnboardingsPlaintextContextIndex0025 } from './migrations/0025_add_onboardings_plaintext_context_index';

// Sits beside the migrations directory rather than in it: the migrations glob loads every file
// there as a migration, and a spec is not one.

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
  const query = jest.fn<Promise<unknown>, [string]>(async () => undefined);

  await new AddOnboardingsPlaintextContextIndex0025()[direction]({ query } as never);

  return query.mock.calls.map(([sql]) => normalize(sql));
};

describe('0025_add_onboardings_plaintext_context_index', () => {
  it('is named for TypeORM to run it in sequence, after 0024', () => {
    expect(AddOnboardingsPlaintextContextIndex0025.name).toBe(
      'AddOnboardingsPlaintextContextIndex0025',
    );
    expect(new AddOnboardingsPlaintextContextIndex0025().name).toMatch(
      /^0025_add_onboardings_plaintext_context_index_\d{13}$/,
    );
  });

  it('creates one partial index over the rows still stored as plain JSON', async () => {
    expect(await runMigration('up')).toEqual([
      "CREATE INDEX idx_onboardings_plaintext_context ON onboardings (id) WHERE NOT (context ? '__tsh_enc')",
    ]);
  });

  it('drops exactly what `up` creates', async () => {
    expect(await runMigration('down')).toEqual([
      'DROP INDEX IF EXISTS idx_onboardings_plaintext_context',
    ]);
  });
});
