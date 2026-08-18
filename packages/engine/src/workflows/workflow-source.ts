/**
 * Where a workflow definition came from. The engine loads three independent sources:
 *
 * - `built-in`  — production-grade workflows shipped inside the engine image. Always loaded.
 * - `fixtures`  — workflows that exist to exercise the engine. Development and test only; the
 *                 configuration is refused under NODE_ENV=production.
 * - `user`      — workflows supplied by the operator, normally a mounted volume. Always loaded.
 */
export const WorkflowSourceKind = {
  BUILT_IN: 'built-in',
  FIXTURES: 'fixtures',
  USER: 'user',
} as const;

export type WorkflowSourceKind = (typeof WorkflowSourceKind)[keyof typeof WorkflowSourceKind];

export type WorkflowSource = Readonly<{
  kind: WorkflowSourceKind;
  directory: string;
  /**
   * Whether a directory that is missing, or holds no workflow files, is tolerated.
   *
   * The built-in directory is optional: it has a default path and the repository ships no
   * production workflows yet, so both "absent" and "empty" are normal. A user or fixture
   * directory was named explicitly, so an unreadable or empty one is a misconfiguration — the
   * operator meant to mount something.
   */
  optional: boolean;
}>;

export const WORKFLOW_SOURCE_CONFIG_KEYS: Readonly<Record<WorkflowSourceKind, string>> = {
  [WorkflowSourceKind.BUILT_IN]: 'BUILTIN_WORKFLOWS_DIR',
  [WorkflowSourceKind.FIXTURES]: 'FIXTURE_WORKFLOWS_DIR',
  [WorkflowSourceKind.USER]: 'WORKFLOWS_DIR',
};
