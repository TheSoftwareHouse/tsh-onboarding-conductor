import {
  BUILT_IN_WORKFLOWS_DIR,
  FIXTURE_WORKFLOWS_DIR,
  WorkflowSourceKind,
} from '../config/workflow-sources';

export { WorkflowSourceKind };

/**
 * The engine loads three independent workflow sources:
 *
 * - `built-in`  — production-grade workflows shipped inside the engine package. Always loaded.
 * - `fixtures`  — workflows that exercise the engine, also shipped in the package. Loaded only
 *                 when FIXTURE_WORKFLOWS_ENABLED is set, which is refused in production.
 * - `user`      — workflows supplied by the operator, normally a mounted volume. Always loaded
 *                 when WORKFLOWS_DIR names a directory.
 *
 * Only the user source has a configurable path; the other two ship with the build.
 */
export type WorkflowSource = Readonly<{
  kind: WorkflowSourceKind;
  directory: string;
  /**
   * Whether a directory that is missing, or holds no workflow files, is tolerated.
   *
   * The built-in directory is optional: the repository ships no production workflows yet, so both
   * "absent" and "empty" are normal. A user directory was named explicitly, so an unreadable or
   * empty one is a misconfiguration — the operator meant to mount something.
   */
  optional: boolean;
}>;

export type WorkflowSourceSettings = Readonly<{
  userDirectory?: string;
  fixturesEnabled: boolean;
}>;

/**
 * Built-in workflows resolve first so that a duplicate id reports the shipped source as the
 * incumbent and the operator's directory as the conflict, which reads the right way round in the
 * error message.
 */
export const resolveWorkflowSources = (
  settings: WorkflowSourceSettings,
): readonly WorkflowSource[] => {
  const sources: WorkflowSource[] = [
    { kind: WorkflowSourceKind.BUILT_IN, directory: BUILT_IN_WORKFLOWS_DIR, optional: true },
  ];

  const userDirectory = settings.userDirectory?.trim();
  if (userDirectory) {
    sources.push({ kind: WorkflowSourceKind.USER, directory: userDirectory, optional: false });
  }

  if (settings.fixturesEnabled) {
    sources.push({
      kind: WorkflowSourceKind.FIXTURES,
      directory: FIXTURE_WORKFLOWS_DIR,
      optional: false,
    });
  }

  return sources;
};
