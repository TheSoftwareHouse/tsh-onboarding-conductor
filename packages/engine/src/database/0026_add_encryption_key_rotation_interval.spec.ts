import { AddEncryptionKeyRotationInterval0026 } from './migrations/0026_add_encryption_key_rotation_interval';

// Sits beside the migrations directory rather than in it: the migrations glob loads every file
// there as a migration, and a spec is not one.

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
  const query = jest.fn<Promise<unknown>, [string]>(async () => undefined);

  await new AddEncryptionKeyRotationInterval0026()[direction]({ query } as never);

  return query.mock.calls.map(([sql]) => normalize(sql));
};

describe('0026_add_encryption_key_rotation_interval', () => {
  it('is named for TypeORM to run it in sequence, after 0025', () => {
    expect(AddEncryptionKeyRotationInterval0026.name).toBe('AddEncryptionKeyRotationInterval0026');
    expect(new AddEncryptionKeyRotationInterval0026().name).toMatch(
      /^0026_add_encryption_key_rotation_interval_\d{13}$/,
    );
  });

  it('adds the schedule column to the key table, nullable so existing keys rotate on no schedule', async () => {
    expect(await runMigration('up')).toEqual([
      'ALTER TABLE encryption_keys ADD COLUMN rotation_interval VARCHAR(8) NULL',
    ]);
  });

  it('drops exactly what `up` creates', async () => {
    expect(await runMigration('down')).toEqual([
      'ALTER TABLE encryption_keys DROP COLUMN IF EXISTS rotation_interval',
    ]);
  });
});
