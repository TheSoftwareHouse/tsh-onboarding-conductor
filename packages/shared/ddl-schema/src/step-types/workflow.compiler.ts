import Ajv, { type AnySchema, type ValidateFunction } from 'ajv';
import { failSchemaValidation } from '../schema/schema-failure';
import { getWorkflowJsonSchema } from '../schema/workflow-json-schema';
import type {
  CompiledWorkflowDefinition,
  CompiledWorkflowStep,
  RawWorkflowDefinition,
  RawWorkflowStepEdge,
  RawWorkflowStepEdgeArm,
  RawWorkflowTransition,
} from '../workflow-contract';
import { failWorkflow, type WorkflowInvalidPath } from '../workflow-invalid.error';
import {
  compileStep,
  hasOwn,
  isPortToken,
  resolveStep,
  TOKEN_MARK,
  type ResolvedStep,
} from './step-compile';
import type { WorkflowStepPort } from './step-type.port';

/** One port as the report describes it: where it leads, arm by arm, in authored step names. */
export type StepPortReport = {
  readonly name: string;
  readonly arms: readonly RawWorkflowStepEdgeArm[];
};

/** One authored step as the report describes it: its type, the compiled steps it owns, its ports. */
export type StepReport = {
  readonly name: string;
  readonly type: string;
  readonly category: string;
  readonly compiledStepNames: readonly string[];
  readonly ports: readonly StepPortReport[];
};

/**
 * What a builder needs back from a compile: the compiled form it produced, and each authored step's
 * resolved shape — the compiled steps it owns and where every port leads — which is what a canvas
 * draws.
 */
export type WorkflowCompilationReport = {
  readonly definition: CompiledWorkflowDefinition;
  readonly steps: readonly StepReport[];
};

type CompiledSchemaValidator = {
  schema: Record<string, unknown>;
  validate: ValidateFunction<RawWorkflowDefinition>;
};

let compiledSchemaValidator: CompiledSchemaValidator | undefined;

/** Compiled on first use and recompiled whenever the registries behind the schema change. */
const getSchemaValidator = (): ValidateFunction<RawWorkflowDefinition> => {
  const schema = getWorkflowJsonSchema();

  if (compiledSchemaValidator?.schema !== schema) {
    compiledSchemaValidator = {
      schema,
      validate: new Ajv({ strict: true, allowUnionTypes: true }).compile(schema as AnySchema),
    };
  }

  return compiledSchemaValidator.validate;
};

const validateSchema = (input: unknown): RawWorkflowDefinition => {
  const validateAgainstSchema = getSchemaValidator();

  if (validateAgainstSchema(input)) {
    return input;
  }

  return failSchemaValidation(validateAgainstSchema.errors?.[0]);
};

/** A wired port's destination, as arms. A plain edge is the one-arm case with no condition. */
type ResolvedEdge = {
  readonly arms: readonly RawWorkflowStepEdgeArm[];
};

/** A resolved step with what the author wired to its ports. */
type WiredStep = ResolvedStep & {
  readonly edges: ReadonlyMap<string, ResolvedEdge>;
};

const toArms = (edge: RawWorkflowStepEdge): readonly RawWorkflowStepEdgeArm[] =>
  typeof edge === 'string' ? [{ target: edge }] : edge;

/**
 * Pairs every declared port with what the author wired to it. The fallback rule mirrors the
 * compiled form's: among a port's arms, at most one may lack a `when`, and it must come last — an arm after
 * the fallback could never be reached.
 */
const resolveEdges = (
  path: WorkflowInvalidPath,
  rawEdges: Readonly<Record<string, RawWorkflowStepEdge>>,
  ports: readonly WorkflowStepPort[],
): ReadonlyMap<string, ResolvedEdge> => {
  const portNames = new Set(ports.map((port) => port.name));
  const edges = new Map<string, ResolvedEdge>();

  for (const portName of Object.keys(rawEdges)) {
    if (!portNames.has(portName)) {
      failWorkflow('INVALID_TRANSITIONS', `${path}.${portName}`);
    }
  }

  for (const port of ports) {
    const declared = hasOwn(rawEdges, port.name) ? rawEdges[port.name] : undefined;

    if (declared === undefined) {
      // An unwired required port is a hole in the graph, not a step that goes nowhere.
      if (port.optional !== true) {
        failWorkflow('INVALID_TRANSITIONS', `${path}.${port.name}`);
      }

      continue;
    }

    const arms = toArms(declared);
    const unconditional = arms.filter((arm) => arm.when === undefined);

    if (
      unconditional.length > 1 ||
      (unconditional.length === 1 && arms[arms.length - 1].when !== undefined)
    ) {
      failWorkflow('INVALID_TRANSITIONS', `${path}.${port.name}`);
    }

    edges.set(port.name, { arms });
  }

  return edges;
};

/**
 * Every step with a path to `target`, by walking the successor graph backwards. Cycles are ordinary
 * here — a retry that loops back makes the looped-to steps ancestors of the step that loops, which
 * is exactly right: they did run before it, on that path.
 */
const collectAncestors = (
  target: string,
  predecessorsByName: ReadonlyMap<string, readonly string[]>,
): Set<string> => {
  const ancestors = new Set<string>();
  const queue = [target];

  while (queue.length > 0) {
    const current = queue.shift() as string;

    for (const predecessor of predecessorsByName.get(current) ?? []) {
      if (!ancestors.has(predecessor)) {
        ancestors.add(predecessor);
        queue.push(predecessor);
      }
    }
  }

  return ancestors;
};

/**
 * Follows a port token to what the author wired: one transition becomes one arm per condition, the
 * step's own `when` — if it had one — conjoined with the arm's, the arm's target resolved to the
 * target step's entry step, and the arm's `webhook` opt-out carried onto the transition it became.
 */
const expandTransition = (
  transition: RawWorkflowTransition,
  edge: ResolvedEdge,
  entryStepByName: ReadonlyMap<string, string>,
): RawWorkflowTransition[] =>
  edge.arms.map((arm) => {
    const when =
      arm.when === undefined
        ? transition.when
        : transition.when === undefined
          ? arm.when
          : { all: [transition.when, arm.when] };

    return {
      ...transition,
      ...(when === undefined ? {} : { when }),
      target: entryStepByName.get(arm.target) as string,
      ...(arm.webhook === undefined ? {} : { webhook: arm.webhook }),
    };
  });

/**
 * Compiles an authored workflow into the compiled form and reports each step's resolved shape.
 * Everything downstream — the compiled schema, the normalizer, the engine — sees only compiled
 * steps, so step types add authoring vocabulary without adding a second runtime. The compiled
 * document is then validated against the compiled schema like an untyped one used to be, which is
 * what keeps a `custom` step from smuggling anything past it.
 */
export const compileWorkflowReport = (input: unknown): WorkflowCompilationReport => {
  const definition = validateSchema(input);
  const resolved: WiredStep[] = definition.steps.map((step, index) => {
    const resolvedStep = resolveStep(step, index);

    return {
      ...resolvedStep,
      edges: resolveEdges(`${resolvedStep.path}.edges`, step.edges ?? {}, resolvedStep.ports),
    };
  });

  const entryStepByName = new Map<string, string>();
  const claimedStepNames = new Set<string>();

  for (const entry of resolved) {
    if (entryStepByName.has(entry.step.name)) {
      failWorkflow('DUPLICATE_STEP_NAME', `${entry.path}.name`);
    }

    entryStepByName.set(entry.step.name, entry.stepNames[0]);

    for (const stepName of entry.stepNames) {
      if (claimedStepNames.has(stepName)) {
        failWorkflow('DUPLICATE_STEP_NAME', `${entry.path}.substeps`);
      }

      claimedStepNames.add(stepName);
    }
  }

  // Which steps each step can hand the customer to, from its edges — every arm of every port.
  const predecessorsByName = new Map<string, string[]>();

  for (const entry of resolved) {
    for (const [port, edge] of entry.edges) {
      for (const arm of edge.arms) {
        if (!entryStepByName.has(arm.target)) {
          failWorkflow('UNKNOWN_TARGET', `${entry.path}.edges.${port}`);
        }

        predecessorsByName.set(arm.target, [
          ...(predecessorsByName.get(arm.target) ?? []),
          entry.step.name,
        ]);
      }
    }
  }

  const steps: CompiledWorkflowStep[] = [];

  for (const entry of resolved) {
    const ancestors = collectAncestors(entry.step.name, predecessorsByName);
    const contributors = resolved.filter(
      (candidate) => candidate === entry || ancestors.has(candidate.step.name),
    );
    const compiled = compileStep(entry, contributors, new Set(entry.edges.keys()));

    const followedPorts = new Set<string>();

    for (const step of compiled) {
      step.transitions = step.transitions.flatMap((transition) => {
        if (!isPortToken(transition.target)) {
          return [transition];
        }

        const [, stepName, port] = transition.target.split(TOKEN_MARK);
        // A token for another step's port, or for a port nobody wired, is a type defect.
        const edge =
          (stepName === entry.step.name ? entry.edges.get(port) : undefined) ??
          failWorkflow('INVALID_SHAPE', entry.path);

        followedPorts.add(port);

        return expandTransition(transition, edge, entryStepByName);
      });
    }

    // Every port the author wired must lead somewhere in the compiled steps; a type that ignores
    // one leaves an edge on the canvas that does nothing.
    for (const port of entry.edges.keys()) {
      if (!followedPorts.has(port)) {
        failWorkflow('INVALID_SHAPE', entry.path);
      }
    }

    // The step's own rules join the step its type named for them, after any the type emitted, so
    // the compiled form's sum-then-clamp sees one list. Resolved by name rather than by index, so a
    // type is free to order its steps as it likes.
    if (entry.step.scoring !== undefined) {
      const scoringStep =
        compiled.find((step) => step.name === entry.scoringStepName) ??
        failWorkflow('INVALID_SHAPE', entry.path);

      scoringStep.scoring = [...(scoringStep.scoring ?? []), ...entry.step.scoring];
    }

    steps.push(...compiled);
  }

  const initialStep = definition.initial ?? definition.steps[0].name;
  const initial = entryStepByName.get(initialStep) ?? failWorkflow('INVALID_VALUE', 'initial');

  // A root declaration binds to an authored step; it is rewritten to that step's entry step — the
  // one carrying the author's own fields, and so the one whose submit can observe `acceptedWhen`.
  const agreements = definition.agreements?.map((agreement, index) => ({
    ...agreement,
    step:
      entryStepByName.get(agreement.step) ??
      failWorkflow('UNKNOWN_TARGET', `agreements[${index}].step`),
  }));

  return {
    definition: {
      id: definition.id,
      version: definition.version,
      ...(definition.name === undefined ? {} : { name: definition.name }),
      initial,
      ...(definition.webhook === undefined ? {} : { webhook: definition.webhook }),
      ...(definition.scoring === undefined ? {} : { scoring: definition.scoring }),
      ...(agreements === undefined ? {} : { agreements }),
      steps,
    },
    steps: resolved.map((entry) => ({
      name: entry.step.name,
      type: entry.definition.type,
      category: entry.definition.category,
      compiledStepNames: entry.stepNames,
      ports: entry.ports.map((port) => ({
        name: port.name,
        arms: [...(entry.edges.get(port.name)?.arms ?? [])],
      })),
    })),
  };
};

/**
 * Compiles an authored workflow into the compiled form. The report is what a builder wants; the
 * validator only needs the document.
 */
export const compileWorkflow = (input: unknown): CompiledWorkflowDefinition =>
  compileWorkflowReport(input).definition;
