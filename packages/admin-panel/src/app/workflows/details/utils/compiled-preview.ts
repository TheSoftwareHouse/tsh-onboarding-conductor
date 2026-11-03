import { tryCompileStep, tryResolveStep, type ResolvedStep } from '@tsh/ddl-schema/step-types';
import type { CompiledWorkflowStep } from '@tsh/ddl-schema/workflow-contract';
import type { AuthoredStep } from './authored-document';

export type CompiledPreview =
  { kind: 'compiled'; steps: CompiledWorkflowStep[] } | { kind: 'failed'; message: string };

function describeFailure(error: unknown): string {
  if (error instanceof Error && 'reason' in error) {
    const path = 'path' in error ? ` at ${String(error.path)}` : '';
    return `${String(error.reason)}${path}`;
  }
  return error instanceof Error ? error.message : 'Does not compile';
}

/** Each authored step compiled on its own against the steps before it, so a failure blanks one preview. */
export function compilePreviews(
  steps: readonly AuthoredStep[],
  ancestorsOf: (name: string) => ReadonlySet<string>,
): Map<string, CompiledPreview> {
  const outcomes = steps.map((step, index) => tryResolveStep(step, index));
  const previews = new Map<string, CompiledPreview>();

  steps.forEach((step, index) => {
    const outcome = outcomes[index];
    if (outcome?.kind !== 'resolved') {
      previews.set(step.name, { kind: 'failed', message: describeFailure(outcome?.error) });
      return;
    }
    const ancestors = ancestorsOf(step.name);
    const contributors = outcomes.flatMap((candidate, candidateIndex): ResolvedStep[] => {
      const candidateStep = steps[candidateIndex];
      const isContributor = candidateStep === step || ancestors.has(candidateStep?.name ?? '');
      return candidate.kind === 'resolved' && isContributor ? [candidate.resolved] : [];
    });
    const compiled = tryCompileStep(
      outcome.resolved,
      contributors,
      new Set(Object.keys(step.edges ?? {})),
    );
    previews.set(
      step.name,
      compiled.kind === 'compiled'
        ? { kind: 'compiled', steps: compiled.steps }
        : { kind: 'failed', message: describeFailure(compiled.error) },
    );
  });
  return previews;
}

/** Field name → the authored steps whose compiled steps create it; more than one fails the workflow. */
export function mapFieldOwners(previews: Map<string, CompiledPreview>): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const [name, preview] of previews) {
    if (preview.kind !== 'compiled') continue;
    for (const compiled of preview.steps) {
      for (const field of Object.keys(compiled.data)) {
        owners.set(field, [...(owners.get(field) ?? []), name]);
      }
    }
  }
  return owners;
}
