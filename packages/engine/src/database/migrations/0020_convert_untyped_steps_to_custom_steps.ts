import { MigrationInterface, QueryRunner } from 'typeorm';

type StoredWorkflowRow = {
  workflow_id: string;
  version: number;
  definition: Record<string, unknown>;
};

const CUSTOM_STEP_TYPE = 'custom';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * An untyped step list: the shape the engine runs, written directly, as every workflow was before
 * step types. A typed step always names its `type`, so one entry without it marks the whole list.
 */
const isUntypedStepList = (steps: unknown): steps is unknown[] =>
  Array.isArray(steps) &&
  !steps.every((step) => isPlainObject(step) && typeof step.type === 'string');

/**
 * One `custom` step per untyped step, the step's members as its config, verbatim. A snapshot of the
 * conversion rather than an import of `@tsh/ddl-schema`'s: the converter there may change shape
 * later, while this migration has to keep producing the document it produced today. Not exported:
 * TypeORM instantiates every export of a file under the migrations glob as a migration class.
 */
const toCustomSteps = (
  root: Record<string, unknown>,
  steps: readonly unknown[],
): Record<string, unknown> => ({
  ...root,
  steps: steps.map((step) => {
    if (!isPlainObject(step)) {
      return step;
    }

    const { name, ...config } = step;

    return { name, type: CUSTOM_STEP_TYPE, config };
  }),
});

/** The reverse, for a document made only of `custom` steps; any other document has no untyped form. */
const toUntypedSteps = (definition: Record<string, unknown>): Record<string, unknown> | null => {
  const { steps, ...root } = definition;

  if (
    !Array.isArray(steps) ||
    !steps.every((step) => isPlainObject(step) && step.type === CUSTOM_STEP_TYPE)
  ) {
    return null;
  }

  return {
    ...root,
    steps: (steps as Record<string, unknown>[]).map((step) => ({
      name: step.name,
      ...(isPlainObject(step.config) ? step.config : {}),
    })),
  };
};

/**
 * Rewrites every stored untyped definition as the typed document it converts to. The DDL stops
 * accepting untyped steps in the same change, and the engine re-validates every stored row at
 * boot, so a row left in the old form would fail the next startup; a row already written as typed
 * steps is left alone. Rewritten in JavaScript rather than SQL because the column is `json` for a
 * reason: a `jsonb` round trip reorders object keys, and a step's field order is the order clients
 * render.
 */
export class ConvertUntypedStepsToCustomSteps0020 implements MigrationInterface {
  name = '0020_convert_untyped_steps_to_custom_steps_2052000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: StoredWorkflowRow[] = await queryRunner.query(
      `SELECT workflow_id, version, definition
         FROM workflows
        WHERE json_typeof(definition -> 'steps') = 'array'`,
    );

    for (const row of rows) {
      const { steps, ...root } = row.definition;

      if (!isUntypedStepList(steps)) {
        continue;
      }

      await queryRunner.query(
        `UPDATE workflows
            SET definition = $1::json, updated_at = now()
          WHERE workflow_id = $2 AND version = $3`,
        [JSON.stringify(toCustomSteps(root, steps)), row.workflow_id, row.version],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows: StoredWorkflowRow[] = await queryRunner.query(
      `SELECT workflow_id, version, definition
         FROM workflows
        WHERE json_typeof(definition -> 'steps') = 'array'`,
    );

    for (const row of rows) {
      const untyped = toUntypedSteps(row.definition);

      // A document of specialized steps has no untyped form to go back to; the engine this
      // migration reverts to cannot load it either way, so the row is left as it is.
      if (untyped === null) {
        continue;
      }

      await queryRunner.query(
        `UPDATE workflows
            SET definition = $1::json, updated_at = now()
          WHERE workflow_id = $2 AND version = $3`,
        [JSON.stringify(untyped), row.workflow_id, row.version],
      );
    }
  }
}
