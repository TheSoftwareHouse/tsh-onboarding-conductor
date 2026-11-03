import type { CompileFailure } from '../../classification/field-class-lookup';

/** What to tell the analyst when a workflow version would not compile and its fields were withheld. */
export function describeCompileFailures(failures: readonly CompileFailure[]): string[] {
  return failures.map(
    ({ workflowId, version, reason }) =>
      `Workflow ${workflowId} version ${version} does not compile, so none of its fields could be classified and all applicant data is withheld: ${reason}`,
  );
}
