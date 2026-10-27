import {
  findStepType,
  resolveStepNames,
  STEP_TYPE,
  type FailWorkflow,
} from '@tsh/ddl-schema/step-types';
import type {
  RawWorkflowDefinition,
  RawWorkflowScoringRule,
  RawWorkflowStep,
  RawWorkflowStepEdge,
  RawWorkflowStepEdgeArm,
  RawWorkflowTransition,
} from '@tsh/ddl-schema/workflow-contract';

export type AuthoredStep = RawWorkflowStep;

export type AuthoredArm = RawWorkflowStepEdgeArm;

/** A draft being edited: only `steps` is required, since the JSON tab may leave out `id` or `version`. */
export type AuthoredDocument = Partial<Omit<RawWorkflowDefinition, 'steps'>> & {
  steps: AuthoredStep[];
};

export type CanvasPosition = { x: number; y: number };

/** The target an unwired arm or transition keeps, so its condition survives until it is rewired. */
export const UNWIRED = '';

const TRANSITION_PORT_PREFIX = 'transition-';
const ARM_HANDLE_SEPARATOR = '#';

export function parseDocument(text: string): AuthoredDocument | string {
  try {
    return checkDocument(JSON.parse(text));
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid JSON';
  }
}

function checkDocument(value: unknown): AuthoredDocument | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'The document is not a JSON object.';
  }
  if (!Array.isArray((value as Record<string, unknown>).steps)) {
    return 'The document has no `steps` array.';
  }
  return value as AuthoredDocument;
}

/** A `custom` step routes through `config.transitions`, each naming a compiled step as its target. */
export function readTransitions(step: AuthoredStep): RawWorkflowTransition[] {
  const transitions = step.config?.transitions;
  return step.type === STEP_TYPE.custom && Array.isArray(transitions)
    ? (transitions as RawWorkflowTransition[])
    : [];
}

/** A port with at least one condition: each of its arms gets a handle of its own. */
export function isBranched(edge: RawWorkflowStepEdge | undefined): edge is AuthoredArm[] {
  return Array.isArray(edge) && edge.some((arm) => arm.when !== undefined);
}

/** A port's arms; a plain edge is one arm with no condition, an unwired port none. */
export function readArms(step: AuthoredStep, port: string): AuthoredArm[] {
  const edge = step.edges?.[port];
  if (edge === undefined) return [];
  return typeof edge === 'string' ? [{ target: edge }] : edge;
}

/** A `custom` step's own scoring rules, which live in its config rather than in `scoring`. */
export function readConfigScoring(step: AuthoredStep): RawWorkflowScoringRule[] {
  const rules = step.config?.scoring;
  return step.type === STEP_TYPE.custom && Array.isArray(rules)
    ? (rules as RawWorkflowScoringRule[])
    : [];
}

/** Every rule a step contributes: its config rules (`custom` only), then its step-level ones. */
export function listScoringRules(step: AuthoredStep): RawWorkflowScoringRule[] {
  return [...readConfigScoring(step), ...(step.scoring ?? [])];
}

export function toArmHandle(port: string, armIndex: number): string {
  return `${port}${ARM_HANDLE_SEPARATOR}${armIndex}`;
}

/** The port and arm a branch handle stands for, or `null` for a port's own handle. */
export function readArmHandle(handle: string): { port: string; armIndex: number } | null {
  const at = handle.lastIndexOf(ARM_HANDLE_SEPARATOR);
  if (at === -1) return null;
  const armIndex = Number(handle.slice(at + 1));
  return Number.isInteger(armIndex) ? { port: handle.slice(0, at), armIndex } : null;
}

export function toTransitionPort(index: number): string {
  return `${TRANSITION_PORT_PREFIX}${index}`;
}

/** The transition index a port stands for, or `null` for an ordinary step-type port. */
export function readTransitionIndex(port: string): number | null {
  return port.startsWith(TRANSITION_PORT_PREFIX)
    ? Number(port.slice(TRANSITION_PORT_PREFIX.length))
    : null;
}

export const throwReason: FailWorkflow = (reason, path) => {
  throw new Error(path === undefined ? reason : `${reason} at ${String(path)}`);
};

/** The step names an authored step compiles to: its own, then its sub-steps'. */
export function listCompiledNames(step: AuthoredStep): string[] {
  const definition = step.type === STEP_TYPE.custom ? undefined : findStepType(step.type);
  if (definition === undefined) return [step.name];
  try {
    const keys = definition.listSubStepKeys(definition.parseConfig(step.config, throwReason));
    return resolveStepNames(step.name, keys, step.substeps ?? {});
  } catch {
    // An invalid config lists no sub-steps; its entry name still counts.
    return [step.name];
  }
}
