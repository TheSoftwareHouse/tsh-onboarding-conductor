import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compileWorkflow,
  convertUntypedSteps,
  validateAndNormalizeWorkflow,
} from '@tsh/ddl-schema';
import type { CompiledWorkflowDefinition } from '@tsh/ddl-schema';
import { ConvertUntypedStepsToCustomSteps0020 } from './migrations/0020_convert_untyped_steps_to_custom_steps';

// Sits beside the migrations directory rather than in it: the migrations glob loads every file
// there as a migration, and a spec is not one.

const FIXTURES_DIR = resolve(__dirname, '../../../../workflows/fixtures');

const readFixture = (fileName: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(FIXTURES_DIR, fileName), 'utf8')) as Record<string, unknown>;

/** A document as one was stored before step types: the fixture's typed steps, compiled back. */
const storedUntypedDocument = (fileName: string): Record<string, unknown> =>
  compileWorkflow(readFixture(fileName)) as unknown as Record<string, unknown>;

type StoredRow = { workflow_id: string; version: number; definition: Record<string, unknown> };

/** Answers the migration's SELECT from `rows` and records every UPDATE it issues, as `[json, id, version]`. */
const runMigration = async (
  direction: 'up' | 'down',
  rows: StoredRow[],
): Promise<[string, string, number][]> => {
  const query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>(async (sql) =>
    sql.trimStart().startsWith('SELECT') ? rows : [],
  );

  await new ConvertUntypedStepsToCustomSteps0020()[direction]({ query } as never);

  return query.mock.calls
    .filter(([sql]) => String(sql).trimStart().startsWith('UPDATE'))
    .map(([, parameters]) => parameters as [string, string, number]);
};

describe('0020_convert_untyped_steps_to_custom_steps', () => {
  it.each(['base.workflow.json', 'scoring.workflow.json', 'sumsub-kyc.workflow.json'])(
    'rewrites a stored untyped %s exactly as the DDL converter does, key order included',
    async (fileName) => {
      const stored = storedUntypedDocument(fileName);
      const [[rewritten]] = await runMigration('up', [
        { workflow_id: 'w', version: 1, definition: stored },
      ]);

      expect(rewritten).toBe(
        JSON.stringify(convertUntypedSteps(stored as unknown as CompiledWorkflowDefinition)),
      );
      expect(() => validateAndNormalizeWorkflow(JSON.parse(rewritten))).not.toThrow();
    },
  );

  it('updates every untyped row in place, keyed by (workflow_id, version)', async () => {
    const stored = storedUntypedDocument('base.workflow.json');
    const updates = await runMigration('up', [
      { workflow_id: 'base', version: 1, definition: stored },
      { workflow_id: 'base', version: 2, definition: { ...stored, version: 2 } },
    ]);

    expect(updates.map(([, id, version]) => [id, version])).toEqual([
      ['base', 1],
      ['base', 2],
    ]);
    expect(JSON.parse(updates[1][0])).toMatchObject({ version: 2 });
  });

  it('leaves a row already written as typed steps alone, whichever types it uses', async () => {
    const updates = await runMigration('up', [
      { workflow_id: 'base', version: 1, definition: readFixture('base.workflow.json') },
      {
        workflow_id: 'base-typed',
        version: 1,
        definition: readFixture('base-typed.workflow.json'),
      },
    ]);

    expect(updates).toEqual([]);
  });

  it('carries an entry that is not an object through unchanged, for the schema to refuse', async () => {
    const [[rewritten]] = await runMigration('up', [
      {
        workflow_id: 'x',
        version: 1,
        definition: { id: 'x', version: 1, name: 'X', steps: ['nope'] },
      },
    ]);

    expect(JSON.parse(rewritten).steps).toEqual(['nope']);
  });

  it('on the way down, restores a document of custom steps and skips one of specialized steps', async () => {
    const stored = storedUntypedDocument('base.workflow.json');
    const updates = await runMigration('down', [
      {
        workflow_id: 'base-typed',
        version: 1,
        definition: readFixture('base-typed.workflow.json'),
      },
      { workflow_id: 'base', version: 1, definition: readFixture('base.workflow.json') },
    ]);

    // A document of specialized steps has no untyped form, so it is left where it is.
    expect(updates.map(([, id]) => id)).toEqual(['base']);
    expect(updates[0][0]).toBe(JSON.stringify(stored));
  });
});
