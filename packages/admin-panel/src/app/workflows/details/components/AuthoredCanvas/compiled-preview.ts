// PoC (throwaway): each authored step compiled on its own, in the browser, so the canvas can find a
// field two steps both create. Mirrors the context `workflow.compiler.ts` builds per step, without
// its `ajv` schema pass; a step that fails here blanks only its own preview.
import { findStepType } from '@tsh/ddl-schema/step-types/step-type.registry';
import { resolveStepNames } from '@tsh/ddl-schema/step-types/step-naming';
import type {
  StepFieldMap,
  WorkflowStepContract,
  WorkflowStepTypeDefinition,
} from '@tsh/ddl-schema/step-types/step-type.port';
import type { CompiledWorkflowStep } from '@tsh/ddl-schema/workflow-contract';
import type { AuthoredStep, Json } from './authored-graph';

/** Stands in for a port's real target; the preview never reads where a port leads. */
const PORT_TOKEN_PREFIX = '@@port:';

export type CompiledPreview =
  { kind: 'compiled'; steps: CompiledWorkflowStep[] } | { kind: 'failed'; message: string };

function fail(reason: string, path?: unknown): never {
  throw new Error(path === undefined ? reason : `${reason} at ${String(path)}`);
}

interface ResolvedPart {
  definition: WorkflowStepTypeDefinition;
  config: unknown;
}

/** The step's own type and each `include`, parsed; throws on the first bad one. */
function resolveParts(step: AuthoredStep): ResolvedPart[] {
  return [{ type: step.type, config: step.config }, ...(step.include ?? [])].map((part) => {
    const definition = findStepType(String(part.type)) as WorkflowStepTypeDefinition | undefined;
    if (definition === undefined) fail(`unknown type ${String(part.type)}`);
    return { definition, config: definition.parseConfig(part.config as Json | undefined, fail) };
  });
}

function assembleContract(parts: ResolvedPart[]): WorkflowStepContract {
  const publications = parts.flatMap(
    ({ definition, config }) => definition.publish?.(config) ?? [],
  );
  return {
    // The compiler refuses two claims on one role; the preview keeps the later one and lets the compile say so.
    canonicalFields: Object.assign({}, ...publications.map((entry) => entry.canonicalFields ?? {})),
    documents: publications.flatMap((entry) => entry.documents ?? []),
    documentOptions: publications.flatMap((entry) => entry.documentOptions ?? []),
    questionnaireItems: publications.flatMap((entry) => entry.questionnaireItems ?? []),
  };
}

/**
 * Every step's compiled preview. `ancestorsOf` gives the authored steps that can run before a step,
 * since a step's contract is what those collect, as in the compiler.
 */
export function compileSteps(
  steps: AuthoredStep[],
  ancestorsOf: (name: string) => Set<string>,
): Map<string, CompiledPreview> {
  const parts = new Map<string, ResolvedPart[] | Error>();
  for (const step of steps) {
    try {
      parts.set(step.name, resolveParts(step));
    } catch (error) {
      parts.set(step.name, error instanceof Error ? error : new Error('Bad config'));
    }
  }

  const previews = new Map<string, CompiledPreview>();
  for (const step of steps) {
    const own = parts.get(step.name)!;
    if (own instanceof Error) {
      previews.set(step.name, { kind: 'failed', message: own.message });
      continue;
    }
    try {
      const [main, ...includes] = own;
      const config = main!.config;
      const fields: StepFieldMap = {};
      for (const part of [main!, ...includes]) {
        Object.assign(fields, part.definition.buildFields(part.config));
      }
      const wired = (step.edges ?? {}) as Json;
      const targets: Record<string, string | undefined> = Object.create(null);
      for (const port of main!.definition.listPorts(config)) {
        targets[port.name] = port.name in wired ? `${PORT_TOKEN_PREFIX}${port.name}` : undefined;
      }
      const ancestors = ancestorsOf(step.name);
      const contributors = steps
        .filter((candidate) => candidate === step || ancestors.has(candidate.name))
        .flatMap((candidate) => {
          const resolved = parts.get(candidate.name);
          return resolved instanceof Error || resolved === undefined ? [] : resolved;
        });
      const compiled = main!.definition.compile({
        name: step.name,
        config,
        stepNames: resolveStepNames(
          step.name,
          main!.definition.listSubStepKeys(config),
          (step.substeps ?? {}) as Record<string, string>,
        ),
        fields,
        targets,
        contract: assembleContract(contributors),
        fail,
      });
      previews.set(step.name, { kind: 'compiled', steps: compiled });
    } catch (error) {
      previews.set(step.name, {
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Does not compile',
      });
    }
  }
  return previews;
}

/** Field name → the authored steps whose compiled steps create it; more than one fails the workflow. */
export function findFieldOwners(previews: Map<string, CompiledPreview>): Map<string, string[]> {
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
