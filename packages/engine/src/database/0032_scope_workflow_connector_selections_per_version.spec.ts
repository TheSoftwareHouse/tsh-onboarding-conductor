import { ScopeWorkflowConnectorSelectionsPerVersion0032 } from './migrations/0032_scope_workflow_connector_selections_per_version';

// Sits beside the migrations directory rather than in it: the migrations glob loads every file
// there as a migration, and a spec is not one.

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/** Runs `up` or `down`, recording every statement issued, each normalized to single-line SQL. */
const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
  const query = jest.fn<Promise<unknown>, [string]>(async () => undefined);

  await new ScopeWorkflowConnectorSelectionsPerVersion0032()[direction]({ query } as never);

  return query.mock.calls.map(([sql]) => normalize(sql));
};

describe('0032_scope_workflow_connector_selections_per_version', () => {
  it('is named for TypeORM to run it in sequence', () => {
    expect(ScopeWorkflowConnectorSelectionsPerVersion0032.name).toBe(
      'ScopeWorkflowConnectorSelectionsPerVersion0032',
    );
    expect(new ScopeWorkflowConnectorSelectionsPerVersion0032().name).toMatch(
      /^0032_scope_workflow_connector_selections_per_version_\d{13}$/,
    );
  });

  it('names a timestamp after migration 0031', () => {
    const timestamp = Number(new ScopeWorkflowConnectorSelectionsPerVersion0032().name.slice(-13));

    expect(timestamp).toBeGreaterThan(2052950400000);
  });

  it('adds the column, expands each row per published version, then tightens the key', async () => {
    const statements = await runMigration('up');

    expect(statements).toHaveLength(6);

    expect(statements[0]).toContain('ADD COLUMN version INTEGER NULL');
    // The old key would refuse the copies inserted next to their source rows.
    expect(statements[0]).toContain('DROP CONSTRAINT pk_workflow_connector_selections');

    expect(statements[1]).toContain('INSERT INTO workflow_connector_selections');
    expect(statements[1]).toContain('JOIN workflow_versions v ON v.workflow_id = s.workflow_id');
    expect(statements[1]).toContain("v.status = 'published'");
    // Rows name compiled steps (an OTP's `_verify`), which the stored document does not list.
    expect(statements[1]).not.toContain('definition');
    expect(statements[1]).toContain('s.connector_id, s.updated_at, s.updated_by');
    expect(statements[1]).toContain('WHERE s.version IS NULL');

    expect(statements[2]).toBe('DELETE FROM workflow_connector_selections WHERE version IS NULL');

    expect(statements[3]).toContain('ALTER COLUMN version SET NOT NULL');

    expect(statements[4]).toContain(
      'ADD CONSTRAINT chk_workflow_connector_selections_version_positive CHECK (version > 0)',
    );

    expect(statements[5]).not.toContain('DROP CONSTRAINT');
    expect(statements[5]).toContain(
      'ADD CONSTRAINT pk_workflow_connector_selections PRIMARY KEY (workflow_id, version, step_name)',
    );
  });

  it('collapses to the highest version per step, then drops the column and restores the key', async () => {
    const statements = await runMigration('down');

    expect(statements).toHaveLength(2);

    expect(statements[0]).toContain('DELETE FROM workflow_connector_selections s');
    expect(statements[0]).toContain('newer.version > s.version');

    expect(statements[1]).toContain('DROP CONSTRAINT pk_workflow_connector_selections');
    expect(statements[1]).toContain(
      'DROP CONSTRAINT chk_workflow_connector_selections_version_positive',
    );
    expect(statements[1]).toContain('DROP COLUMN version');
    expect(statements[1]).toContain(
      'ADD CONSTRAINT pk_workflow_connector_selections PRIMARY KEY (workflow_id, step_name)',
    );
  });
});
