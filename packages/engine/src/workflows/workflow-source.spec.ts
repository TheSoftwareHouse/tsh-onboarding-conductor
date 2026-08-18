import { BUILT_IN_WORKFLOWS_DIR, FIXTURE_WORKFLOWS_DIR } from '../config/workflow-directories';
import { resolveWorkflowSources, WorkflowSourceKind } from './workflow-source';

describe('resolveWorkflowSources', () => {
  it('always resolves the built-in source, and tolerates it being empty', () => {
    const sources = resolveWorkflowSources({ fixturesEnabled: false });

    expect(sources).toEqual([
      {
        kind: WorkflowSourceKind.BUILT_IN,
        directory: BUILT_IN_WORKFLOWS_DIR,
        optional: true,
      },
    ]);
  });

  it('resolves built-in before user so a collision names the shipped source first', () => {
    const sources = resolveWorkflowSources({
      userDirectory: '/srv/workflows',
      fixturesEnabled: false,
    });

    expect(sources.map((source) => source.kind)).toEqual([
      WorkflowSourceKind.BUILT_IN,
      WorkflowSourceKind.USER,
    ]);
    expect(sources[1]).toMatchObject({ directory: '/srv/workflows', optional: false });
  });

  it('omits the fixture source unless it is enabled', () => {
    expect(
      resolveWorkflowSources({ fixturesEnabled: false }).some(
        (source) => source.kind === WorkflowSourceKind.FIXTURES,
      ),
    ).toBe(false);

    expect(resolveWorkflowSources({ fixturesEnabled: true })).toContainEqual({
      kind: WorkflowSourceKind.FIXTURES,
      directory: FIXTURE_WORKFLOWS_DIR,
      optional: false,
    });
  });

  it.each([['   '], ['']])('ignores a blank user directory (%p)', (userDirectory) => {
    expect(
      resolveWorkflowSources({ userDirectory, fixturesEnabled: false }).some(
        (source) => source.kind === WorkflowSourceKind.USER,
      ),
    ).toBe(false);
  });

  it('resolves the shipped directories inside the engine package', () => {
    expect(BUILT_IN_WORKFLOWS_DIR.endsWith('/packages/engine/workflows/built-in')).toBe(true);
    expect(FIXTURE_WORKFLOWS_DIR.endsWith('/packages/engine/workflows/fixtures')).toBe(true);
  });
});
