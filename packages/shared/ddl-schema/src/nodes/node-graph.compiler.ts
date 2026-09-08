import Ajv, { type AnySchema, type ValidateFunction } from 'ajv';
import type { RawWorkflowCondition } from '../workflow-condition';
import type {
  RawWorkflowDefinition,
  RawWorkflowStep,
  RawWorkflowTransition,
} from '../workflow-contract';
import {
  failWorkflow,
  locateWorkflowFailure,
  toWorkflowInvalidPath,
  type WorkflowInvalidPath,
} from '../workflow-invalid.error';
import { resolveStepNames } from './node-naming';
import type {
  RawWorkflowNode,
  RawWorkflowNodeEdge,
  RawWorkflowNodeEdgeArm,
  RawWorkflowNodeGraphDefinition,
  RawWorkflowNodeInclude,
} from './node-graph.contract';
import { getNodeGraphJsonSchema } from './node-graph.schema';
import { getNodeType } from './node-type.registry';
import type {
  CanonicalFieldMap,
  CanonicalFieldRole,
  NodeFieldMap,
  PublishedDocument,
  PublishedDocumentOption,
  PublishedQuestionnaireItem,
  ResolvedNodeInclude,
  WorkflowNodeContract,
  WorkflowNodePort,
  WorkflowNodeTypeDefinition,
} from './node-type.port';

/** One port as the report describes it: where it leads, arm by arm, in authored node names. */
export type NodePortReport = {
  readonly name: string;
  readonly arms: readonly { readonly when?: RawWorkflowCondition; readonly target: string }[];
};

export type NodeReport = {
  readonly name: string;
  readonly type: string;
  readonly category: string;
  readonly stepNames: readonly string[];
  readonly ports: readonly NodePortReport[];
};

/**
 * What a builder needs back from a compile: the step form it produced, and each node's resolved
 * shape — the steps it owns and where every port leads — which is what a canvas draws.
 */
export type NodeGraphReport = {
  readonly definition: RawWorkflowDefinition;
  readonly nodes: readonly NodeReport[];
};

type CompiledSchemaValidator = {
  schema: Record<string, unknown>;
  validate: ValidateFunction<RawWorkflowNodeGraphDefinition>;
};

let compiledSchemaValidator: CompiledSchemaValidator | undefined;

/** Compiled on first use and recompiled whenever the registries behind the schema change. */
const getSchemaValidator = (): ValidateFunction<RawWorkflowNodeGraphDefinition> => {
  const schema = getNodeGraphJsonSchema();

  if (compiledSchemaValidator?.schema !== schema) {
    compiledSchemaValidator = {
      schema,
      validate: new Ajv({ strict: true, allowUnionTypes: true }).compile(schema as AnySchema),
    };
  }

  return compiledSchemaValidator.validate;
};

const validateSchema = (input: unknown): RawWorkflowNodeGraphDefinition => {
  const validateAgainstSchema = getSchemaValidator();

  if (validateAgainstSchema(input)) {
    return input;
  }

  const firstError = validateAgainstSchema.errors?.[0];
  const path = toWorkflowInvalidPath(firstError?.instancePath ?? '');

  if (firstError?.keyword === 'additionalProperties') {
    failWorkflow('UNKNOWN_PROPERTY', path);
  }

  if (firstError?.keyword === 'required' || firstError?.keyword === 'type') {
    failWorkflow('INVALID_SHAPE', path);
  }

  return failWorkflow('INVALID_VALUE', path);
};

// Names come from untrusted workflow JSON. `in` and a bare index read walk the prototype, so a node
// or field called `constructor` would collide with `Object.prototype` rather than with another
// node — the same reason the registries are Maps.
const hasOwn = (target: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

/**
 * What a node type writes as a transition's `target` to follow a port. The compiler substitutes the
 * real destination afterwards. The marker is NUL, which cannot appear in a node name (the schema
 * restricts those to `[A-Za-z0-9_-]`), so a token can never be mistaken for a step.
 */
const TOKEN_MARK = String.fromCharCode(0);

const buildPortToken = (nodeName: string, port: string): string =>
  `${TOKEN_MARK}${nodeName}${TOKEN_MARK}${port}${TOKEN_MARK}`;

const isPortToken = (target: string | undefined): target is string =>
  target !== undefined && target.startsWith(TOKEN_MARK);

/** A wired port's destination, as arms. A plain edge is the one-arm case with no condition. */
type ResolvedEdge = {
  readonly arms: readonly RawWorkflowNodeEdgeArm[];
};

/** One node, resolved: its type, its parsed config, its fragments, its ports and where they lead. */
type ResolvedNode = {
  readonly path: WorkflowInvalidPath;
  readonly node: RawWorkflowNode;
  readonly definition: WorkflowNodeTypeDefinition;
  readonly config: unknown;
  readonly includes: readonly ResolvedNodeInclude[];
  readonly fields: NodeFieldMap;
  readonly stepNames: readonly string[];
  readonly ports: readonly WorkflowNodePort[];
  readonly edges: ReadonlyMap<string, ResolvedEdge>;
};

const resolveInclude = (include: RawWorkflowNodeInclude): ResolvedNodeInclude => {
  const definition = getNodeType(include.type);

  // A fragment contributes fields to someone else's step; a type with control flow of its own would
  // lose it silently in the merge.
  if (definition.composable !== true) {
    failWorkflow('INVALID_VALUE');
  }

  return { definition, include, config: definition.parseConfig(include.config, failWorkflow) };
};

const toArms = (edge: RawWorkflowNodeEdge): readonly RawWorkflowNodeEdgeArm[] =>
  typeof edge === 'string' ? [{ target: edge }] : edge;

/**
 * Pairs every declared port with what the author wired to it. The fallback rule mirrors the step
 * form's: among a port's arms, at most one may lack a `when`, and it must come last — an arm after
 * the fallback could never be reached.
 */
const resolveEdges = (
  path: WorkflowInvalidPath,
  rawEdges: Readonly<Record<string, RawWorkflowNodeEdge>>,
  ports: readonly WorkflowNodePort[],
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

const resolveNode = (node: RawWorkflowNode, index: number): ResolvedNode => {
  const path = `nodes[${index}]`;
  const definition = locateWorkflowFailure(`${path}.type`, () => getNodeType(node.type));
  const config = locateWorkflowFailure(`${path}.config`, () =>
    definition.parseConfig(node.config, failWorkflow),
  );
  const subStepKeys = definition.listSubStepKeys(config);
  const overrides = node.steps ?? {};

  for (const key of Object.keys(overrides)) {
    // Renaming a sub-step this type does not have would silently do nothing.
    if (!subStepKeys.includes(key)) {
      failWorkflow('INVALID_VALUE', `${path}.steps.${key}`);
    }
  }

  const includes = (node.include ?? []).map((include, includeIndex) =>
    locateWorkflowFailure(`${path}.include[${includeIndex}]`, () => resolveInclude(include)),
  );

  // The node type's own fields lead, then each fragment in declared order — which is the order the
  // client renders them in, so the composition an author wrote is the form the applicant sees.
  const fields: NodeFieldMap = { ...definition.buildFields(config) };

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

  return {
    path,
    node,
    definition,
    config,
    includes,
    fields,
    stepNames: resolveStepNames(node.name, subStepKeys, overrides),
    ports,
    edges: resolveEdges(`${path}.edges`, node.edges ?? {}, ports),
  };
};

/**
 * What the given nodes published, in their order. Scoped per consumer to the nodes that can precede
 * it, which is what lets a node read what its neighbours collect — a `kyc` node compiled in
 * isolation would have to be told its own field mapping — without a node placed *after* it leaking
 * a field into that mapping that will never have been collected when the mapping is read.
 */
const assembleContract = (contributors: readonly ResolvedNode[]): WorkflowNodeContract => {
  const canonicalFields: CanonicalFieldMap = {};
  const documents: PublishedDocument[] = [];
  const documentOptions: PublishedDocumentOption[] = [];
  const questionnaireItems: PublishedQuestionnaireItem[] = [];

  const absorb = (
    path: WorkflowInvalidPath,
    definition: WorkflowNodeTypeDefinition,
    config: unknown,
  ): void => {
    const publication = definition.publish?.(config);

    if (publication === undefined) {
      return;
    }

    for (const [role, fieldName] of Object.entries(publication.canonicalFields ?? {})) {
      // Two nodes claiming one role leaves every consumer guessing which one it meant.
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
 * Every node with a path to `target`, by walking the successor graph backwards. Cycles are ordinary
 * here — a retry that loops back makes the looped-to nodes ancestors of the node that loops, which
 * is exactly right: they did run before it, on that path.
 */
const collectAncestors = (
  target: string,
  predecessorsByNode: ReadonlyMap<string, readonly string[]>,
): Set<string> => {
  const ancestors = new Set<string>();
  const queue = [target];

  while (queue.length > 0) {
    const current = queue.shift() as string;

    for (const predecessor of predecessorsByNode.get(current) ?? []) {
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
 * node's own `when` — if it had one — conjoined with the arm's, and the arm's target resolved to
 * the target node's entry step.
 */
const expandTransition = (
  transition: RawWorkflowTransition,
  edge: ResolvedEdge,
  entryStepByNode: ReadonlyMap<string, string>,
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
      target: entryStepByNode.get(arm.target) as string,
    };
  });

/**
 * Compiles an authored node graph into the step form and reports each node's resolved shape.
 * Everything downstream — the step schema, the normalizer, the engine — sees only steps, so the
 * node layer adds authoring vocabulary without adding a second runtime. The compiled document is
 * then validated against the step schema like any hand-written one, which is what keeps a
 * `custom-step` from smuggling anything past it.
 */
export const compileNodeGraphReport = (input: unknown): NodeGraphReport => {
  const definition = validateSchema(input);
  const resolved = definition.nodes.map((node, index) => resolveNode(node, index));

  const entryStepByNode = new Map<string, string>();
  const claimedStepNames = new Set<string>();

  for (const entry of resolved) {
    if (entryStepByNode.has(entry.node.name)) {
      failWorkflow('DUPLICATE_STEP_NAME', `${entry.path}.name`);
    }

    entryStepByNode.set(entry.node.name, entry.stepNames[0]);

    for (const stepName of entry.stepNames) {
      if (claimedStepNames.has(stepName)) {
        failWorkflow('DUPLICATE_STEP_NAME', `${entry.path}.steps`);
      }

      claimedStepNames.add(stepName);
    }
  }

  // Which nodes each node can hand the customer to, from its edges — every arm of every port.
  const predecessorsByNode = new Map<string, string[]>();

  for (const entry of resolved) {
    for (const [port, edge] of entry.edges) {
      for (const arm of edge.arms) {
        if (!entryStepByNode.has(arm.target)) {
          failWorkflow('UNKNOWN_TARGET', `${entry.path}.edges.${port}`);
        }

        predecessorsByNode.set(arm.target, [
          ...(predecessorsByNode.get(arm.target) ?? []),
          entry.node.name,
        ]);
      }
    }
  }

  const steps: RawWorkflowStep[] = [];

  for (const entry of resolved) {
    const ancestors = collectAncestors(entry.node.name, predecessorsByNode);
    const contributors = resolved.filter(
      (candidate) => candidate === entry || ancestors.has(candidate.node.name),
    );
    // Prototype-less: a type reads `targets[port]` by bare index, and the schema has already
    // refused the names `Object.prototype` answers to, but a map handed to code outside this
    // module should not depend on that — an undeclared port must read as `undefined`, never as
    // an inherited function, and `__proto__` must be an ordinary key, not a setter.
    const targets: Record<string, string | undefined> = Object.create(null);

    for (const port of entry.ports) {
      targets[port.name] = entry.edges.has(port.name)
        ? buildPortToken(entry.node.name, port.name)
        : undefined;
    }

    const compiled = locateWorkflowFailure(entry.path, () =>
      entry.definition.compile({
        name: entry.node.name,
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

        const [, nodeName, port] = transition.target.split(TOKEN_MARK);
        // A token for another node's port, or for a port nobody wired, is a type defect.
        const edge =
          (nodeName === entry.node.name ? entry.edges.get(port) : undefined) ??
          failWorkflow('INVALID_SHAPE', entry.path);

        followedPorts.add(port);

        return expandTransition(transition, edge, entryStepByNode);
      });
    }

    // Every port the author wired must lead somewhere in the compiled steps; a type that ignores
    // one leaves an edge on the canvas that does nothing.
    for (const port of entry.edges.keys()) {
      if (!followedPorts.has(port)) {
        failWorkflow('INVALID_SHAPE', entry.path);
      }
    }

    steps.push(...compiled);
  }

  const initialNode = definition.initial ?? definition.nodes[0].name;
  const initial = entryStepByNode.get(initialNode) ?? failWorkflow('INVALID_VALUE', 'initial');

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
    nodes: resolved.map((entry) => ({
      name: entry.node.name,
      type: entry.definition.type,
      category: entry.definition.category,
      stepNames: entry.stepNames,
      ports: entry.ports.map((port) => ({
        name: port.name,
        arms: [...(entry.edges.get(port.name)?.arms ?? [])],
      })),
    })),
  };
};

/**
 * Compiles an authored node graph into the step form. The report is what a builder wants; the
 * validator only needs the document.
 */
export const compileNodeGraph = (input: unknown): RawWorkflowDefinition =>
  compileNodeGraphReport(input).definition;
