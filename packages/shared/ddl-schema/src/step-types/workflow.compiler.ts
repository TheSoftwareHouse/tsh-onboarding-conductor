import Ajv, { type AnySchema, type ValidateFunction } from 'ajv';
import { failSchemaValidation } from '../schema/schema-failure';
import { getWorkflowJsonSchema } from '../schema/workflow-json-schema';
import type {
  CompiledWorkflowDefinition,
  CompiledWorkflowStep,
  RawWorkflowDefinition,
  RawWorkflowStep,
  RawWorkflowStepEdge,
  RawWorkflowStepEdgeArm,
  RawWorkflowStepInclude,
  RawWorkflowTransition,
} from '../workflow-contract';
import {
  failWorkflow,
  locateWorkflowFailure,
  type WorkflowInvalidPath,
} from '../workflow-invalid.error';
import { resolveStepNames } from './step-naming';
import { getStepType } from './step-type.registry';
import type {
  CanonicalFieldMap,
  CanonicalFieldRole,
  StepFieldMap,
  PublishedDocument,
  PublishedDocumentOption,
  PublishedQuestionnaireItem,
  ResolvedStepInclude,
  WorkflowStepContract,
  WorkflowStepPort,
  WorkflowStepTypeDefinition,
} from './step-type.port';

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

// Names come from untrusted workflow JSON. `in` and a bare index read walk the prototype, so a step
// or field called `constructor` would collide with `Object.prototype` rather than with another
// step — the same reason the registries are Maps.
const hasOwn = (target: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

/**
 * What a step type writes as a transition's `target` to follow a port. The compiler substitutes the
 * real destination afterwards. The marker is NUL, which cannot appear in a step name (the schema
 * restricts those to `[A-Za-z0-9_-]`), so a token can never be mistaken for a step.
 */
const TOKEN_MARK = String.fromCharCode(0);

const buildPortToken = (stepName: string, port: string): string =>
  `${TOKEN_MARK}${stepName}${TOKEN_MARK}${port}${TOKEN_MARK}`;

const isPortToken = (target: string | undefined): target is string =>
  target !== undefined && target.startsWith(TOKEN_MARK);

/** A wired port's destination, as arms. A plain edge is the one-arm case with no condition. */
type ResolvedEdge = {
  readonly arms: readonly RawWorkflowStepEdgeArm[];
};

/** One authored step, resolved: its type, its parsed config, its fragments, its ports and where they lead. */
type ResolvedStep = {
  readonly path: WorkflowInvalidPath;
  readonly step: RawWorkflowStep;
  readonly definition: WorkflowStepTypeDefinition;
  readonly config: unknown;
  readonly includes: readonly ResolvedStepInclude[];
  readonly fields: StepFieldMap;
  readonly stepNames: readonly string[];
  /** The compiled step this step's own `scoring` rules attach to; absent when the type accepts none. */
  readonly scoringStepName: string | undefined;
  readonly ports: readonly WorkflowStepPort[];
  readonly edges: ReadonlyMap<string, ResolvedEdge>;
};

const resolveInclude = (include: RawWorkflowStepInclude): ResolvedStepInclude => {
  const definition = getStepType(include.type);

  // A fragment contributes fields to someone else's step; a type with control flow of its own would
  // lose it silently in the merge.
  if (definition.composable !== true) {
    failWorkflow('INVALID_VALUE');
  }

  return { definition, include, config: definition.parseConfig(include.config, failWorkflow) };
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

const resolveStep = (step: RawWorkflowStep, index: number): ResolvedStep => {
  const path = `steps[${index}]`;
  const definition = locateWorkflowFailure(`${path}.type`, () => getStepType(step.type));
  const config = locateWorkflowFailure(`${path}.config`, () =>
    definition.parseConfig(step.config, failWorkflow),
  );
  const subStepKeys = definition.listSubStepKeys(config);
  const overrides = step.substeps ?? {};

  for (const key of Object.keys(overrides)) {
    // Renaming a sub-step this type does not have would silently do nothing.
    if (!subStepKeys.includes(key)) {
      failWorkflow('INVALID_VALUE', `${path}.substeps.${key}`);
    }
  }

  const includes = (step.include ?? []).map((include, includeIndex) =>
    locateWorkflowFailure(`${path}.include[${includeIndex}]`, () => resolveInclude(include)),
  );

  // The step type's own fields lead, then each fragment in declared order — which is the order the
  // client renders them in, so the composition an author wrote is the form the applicant sees.
  const fields: StepFieldMap = { ...definition.buildFields(config) };

  includes.forEach((fragment, includeIndex) => {
    const fragmentFields = fragment.definition.buildFields(fragment.config);

    for (const fieldName of Object.keys(fragmentFields)) {
      if (hasOwn(fields, fieldName)) {
        failWorkflow('DUPLICATE_FIELD_NAME', `${path}.include[${includeIndex}]`);
      }

      fields[fieldName] = fragmentFields[fieldName];
    }
  });

  const ports = definition.listPorts(config);
  const stepNames = resolveStepNames(step.name, subStepKeys, overrides);
  // The entry step unless the type says otherwise; `undefined` means the type takes no rules at all.
  const scoringKey =
    definition.resolveScoringStepKey === undefined
      ? subStepKeys[0]
      : definition.resolveScoringStepKey(config);

  if (step.scoring !== undefined && scoringKey === undefined) {
    failWorkflow('INVALID_VALUE', `${path}.scoring`);
  }

  // A type naming a sub-step it does not have is a type defect, not an authoring one.
  if (scoringKey !== undefined && !subStepKeys.includes(scoringKey)) {
    failWorkflow('INVALID_SHAPE', path);
  }

  return {
    path,
    step,
    definition,
    config,
    includes,
    fields,
    stepNames,
    scoringStepName:
      scoringKey === undefined ? undefined : stepNames[subStepKeys.indexOf(scoringKey)],
    ports,
    edges: resolveEdges(`${path}.edges`, step.edges ?? {}, ports),
  };
};

/**
 * What the given steps published, in their order. Scoped per consumer to the steps that can precede
 * it, which is what lets a step read what its neighbours collect — a `kyc` step compiled in
 * isolation would have to be told its own field mapping — without a step placed *after* it leaking
 * a field into that mapping that will never have been collected when the mapping is read.
 */
const assembleContract = (contributors: readonly ResolvedStep[]): WorkflowStepContract => {
  const canonicalFields: CanonicalFieldMap = {};
  const documents: PublishedDocument[] = [];
  const documentOptions: PublishedDocumentOption[] = [];
  const questionnaireItems: PublishedQuestionnaireItem[] = [];

  const absorb = (
    path: WorkflowInvalidPath,
    definition: WorkflowStepTypeDefinition,
    config: unknown,
  ): void => {
    const publication = definition.publish?.(config);

    if (publication === undefined) {
      return;
    }

    for (const [role, fieldName] of Object.entries(publication.canonicalFields ?? {})) {
      // Two steps claiming one role leaves every consumer guessing which one it meant.
      if (canonicalFields[role as CanonicalFieldRole] !== undefined) {
        failWorkflow('DUPLICATE_FIELD_NAME', path);
      }

      canonicalFields[role as CanonicalFieldRole] = fieldName;
    }

    documents.push(...(publication.documents ?? []));
    documentOptions.push(...(publication.documentOptions ?? []));
    questionnaireItems.push(...(publication.questionnaireItems ?? []));
  };

  for (const entry of contributors) {
    absorb(entry.path, entry.definition, entry.config);

    entry.includes.forEach((fragment, includeIndex) => {
      absorb(`${entry.path}.include[${includeIndex}]`, fragment.definition, fragment.config);
    });
  }

  return { canonicalFields, documents, documentOptions, questionnaireItems };
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
  const resolved = definition.steps.map((step, index) => resolveStep(step, index));

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
    // Prototype-less: a type reads `targets[port]` by bare index, and the schema has already
    // refused the names `Object.prototype` answers to, but a map handed to code outside this
    // module should not depend on that — an undeclared port must read as `undefined`, never as
    // an inherited function, and `__proto__` must be an ordinary key, not a setter.
    const targets: Record<string, string | undefined> = Object.create(null);

    for (const port of entry.ports) {
      targets[port.name] = entry.edges.has(port.name)
        ? buildPortToken(entry.step.name, port.name)
        : undefined;
    }

    const compiled = locateWorkflowFailure(entry.path, () =>
      entry.definition.compile({
        name: entry.step.name,
        config: entry.config,
        stepNames: entry.stepNames,
        fields: entry.fields,
        targets,
        contract: assembleContract(contributors),
        fail: failWorkflow,
      }),
    );

    // A type that emits steps other than the ones it declared would produce names no edge can
    // reach, or reach a step that was never declared. Checked name by name, not just by count.
    if (
      compiled.length !== entry.stepNames.length ||
      compiled.some((step, index) => step.name !== entry.stepNames[index])
    ) {
      failWorkflow('INVALID_SHAPE', entry.path);
    }

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

  return {
    definition: {
      id: definition.id,
      version: definition.version,
      name: definition.name,
      initial,
      ...(definition.webhook === undefined ? {} : { webhook: definition.webhook }),
      ...(definition.scoring === undefined ? {} : { scoring: definition.scoring }),
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
