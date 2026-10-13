import { CreateWorkflowConnectorSelections0030 } from './migrations/0030_create_workflow_connector_selections';

// Sits beside the migrations directory rather than in it: the migrations glob loads every file
// there as a migration, and a spec is not one.

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/** Runs `up` or `down`, recording every statement issued, each normalized to single-line SQL. */
const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
  const query = jest.fn<Promise<unknown>, [string]>(async () => undefined);

  await new CreateWorkflowConnectorSelections0030()[direction]({ query } as never);

  return query.mock.calls.map(([sql]) => normalize(sql));
};

describe('0030_create_workflow_connector_selections', () => {
  it('is named for TypeORM to run it in sequence', () => {
    expect(CreateWorkflowConnectorSelections0030.name).toBe(
      'CreateWorkflowConnectorSelections0030',
    );
    expect(new CreateWorkflowConnectorSelections0030().name).toMatch(
      /^0030_create_workflow_connector_selections_\d{13}$/,
    );
  });

  it('creates the table without a foreign key, then adds the constraint on its own', async () => {
    const statements = await runMigration('up');

    expect(statements).toHaveLength(2);

    expect(statements[0]).toContain('CREATE TABLE workflow_connector_selections');
    expect(statements[0]).toContain('workflow_id UUID NOT NULL');
    expect(statements[0]).toContain('step_name VARCHAR(100) NOT NULL');
    expect(statements[0]).toContain('connector_id VARCHAR(64) NOT NULL');
    expect(statements[0]).toContain('updated_at TIMESTAMPTZ NOT NULL DEFAULT now()');
    expect(statements[0]).toContain('updated_by VARCHAR(255) NULL');
    expect(statements[0]).toContain(
      'CONSTRAINT pk_workflow_connector_selections PRIMARY KEY (workflow_id, step_name)',
    );
    expect(statements[0]).toContain("CHECK (btrim(step_name) <> '')");
    expect(statements[0]).toContain("CHECK (connector_id ~ '^[a-z0-9_]+$')");
    expect(statements[0]).not.toContain('FOREIGN KEY');

    expect(statements[1]).toContain('ALTER TABLE workflow_connector_selections');
    expect(statements[1]).toContain(
      'ADD CONSTRAINT fk_workflow_connector_selections_workflow FOREIGN KEY (workflow_id) REFERENCES workflows (workflow_id) ON DELETE CASCADE',
    );
  });

  it('drops the table, which takes its constraints with it', async () => {
    expect(await runMigration('down')).toEqual([
      'DROP TABLE IF EXISTS workflow_connector_selections',
    ]);
  });
});
