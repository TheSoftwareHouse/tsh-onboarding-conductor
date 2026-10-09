import { AddWorkflowVersionsOneDraftIndex0029 } from './migrations/0029_add_workflow_versions_one_draft_index';

// Sits beside the migrations directory rather than in it: the migrations glob loads every file
// there as a migration, and a spec is not one.

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/** Runs `up` or `down`, recording every statement issued, each normalized to single-line SQL. */
const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
  const query = jest.fn<Promise<unknown>, [string]>(async () => undefined);

  await new AddWorkflowVersionsOneDraftIndex0029()[direction]({ query } as never);

  return query.mock.calls.map(([sql]) => normalize(sql));
};

describe('0029_add_workflow_versions_one_draft_index', () => {
  it('is named for TypeORM to run it in sequence', () => {
    expect(AddWorkflowVersionsOneDraftIndex0029.name).toBe('AddWorkflowVersionsOneDraftIndex0029');
    expect(new AddWorkflowVersionsOneDraftIndex0029().name).toMatch(
      /^0029_add_workflow_versions_one_draft_index_\d{13}$/,
    );
  });

  it('creates the partial unique index over draft versions', async () => {
    expect(await runMigration('up')).toEqual([
      "CREATE UNIQUE INDEX uq_workflow_versions_one_draft ON workflow_versions (workflow_id) WHERE status = 'draft'",
    ]);
  });

  it('drops the index', async () => {
    expect(await runMigration('down')).toEqual([
      'DROP INDEX IF EXISTS uq_workflow_versions_one_draft',
    ]);
  });
});
