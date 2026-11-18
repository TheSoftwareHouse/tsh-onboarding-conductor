import {
  findStepType,
  listStepTypes,
  STEP_TYPE,
  type WorkflowStepCategory,
  type WorkflowStepPort,
} from '@tsh/ddl-schema/step-types';
import {
  FIELD_TYPE,
  TERMINAL_WORKFLOW_STATUSES,
  WORKFLOW_STATUS,
  type RawWorkflowField,
  type RawWorkflowTransition,
} from '@tsh/ddl-schema/workflow-contract';
import type { Agreement } from './agreements';
import {
  isBranched,
  listCompiledNames,
  listScoringRules,
  readArms,
  readTransitionIndex,
  readTransitions,
  toArmHandle,
  throwReason,
  toTransitionPort,
  UNWIRED,
  type AuthoredDocument,
  type AuthoredStep,
} from './authored-document';
import { checkStepConfig } from './check-config';
import { describeCondition } from './describe-condition';
import { isPlainObject } from './is-plain-object';
import { pluralize } from './pluralize';
import { compilePreviews, mapFieldOwners, type CompiledPreview } from './compiled-preview';

type StepConfig = Record<string, unknown>;

const MANUAL_STATUS_PREFIX = 'manual.';

/** A port as the canvas draws it; a `custom` step's transitions become ports with a display label. */
export type CanvasPort = WorkflowStepPort & { label?: string; detail?: string };

export type PortState =
  | { kind: 'known'; ports: readonly CanvasPort[] }
  | { kind: 'config-error'; message: string }
  | { kind: 'unknown-type' };

export type SectionField = { name: string; type: string; required: boolean };

/** One part of a step: its own type (`include: null`) or one of its included sections. */
export type StepSection = {
  type: string;
  include: number | null;
  config: StepConfig;
  fields: SectionField[] | { error: string };
};

export type ProjectedStep = {
  step: AuthoredStep;
  index: number;
  category: WorkflowStepCategory | null;
  ports: PortState;
  /** Ports listed by the type with nothing wired (required ones fail the document). */
  unwired: string[];
  /** Ports with an arm or transition whose target was unwired; they fail the document even if optional. */
  unfinished: string[];
  /** Edge keys the type does not have (left after a config change removed the port). */
  strayPorts: string[];
  isInitial: boolean;
  /** The node's detail line: terminal outcome, connector id, or status and field count. */
  summary: string;
  /** Every field the step's compiled steps store, sub-steps included; `null` when it does not compile. */
  storedFields: SectionField[] | null;
  /** Stored yes/no fields the panel offers as agreements: a `consents` section's or a `custom` step's, plus any one an agreement already names; `null` when it does not compile. */
  agreementFields: string[] | null;
  /** Why the step cannot run as written; empty when it can. */
  issues: string[];
  /** Fields its compiled steps create that another step (or another of its sub-steps) also creates, with those owners. */
  duplicateFields: Map<string, string[]>;
};

/** A field some step stores; `type` is `null` when only a step that does not compile declares it. */
export type WorkflowField = { name: string; type: string | null; steps: string[] };

export type WorkflowScore = { name: string; min: number; max: number };

/** What the workflow's conditions and settings can name: every stored field and every declared score. */
export type WorkflowContents = { fields: WorkflowField[]; scores: WorkflowScore[] };

export type ProjectedEdge = {
  id: string;
  source: string;
  port: string;
  armIndex: number | null;
  /** The source handle it leaves from: the port's own, or its branch's on a branched port. */
  handle: string;
  target: string;
  label: string;
  /** Just the condition the edge is taken on, without the port name; empty when unconditional. */
  condition: string;
  dangling: boolean;
};

function isTerminalStatus(status: unknown): boolean {
  return TERMINAL_WORKFLOW_STATUSES.some((terminal) => terminal === status);
}

function isGuarded(transition: RawWorkflowTransition): boolean {
  return transition.when !== undefined || Boolean(transition.reason?.length);
}

function describeGuard(transition: RawWorkflowTransition): string {
  return [
    transition.when !== undefined ? `when ${describeCondition(transition.when)}` : null,
    transition.reason?.length ? `reason ${transition.reason.join(', ')}` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

/** Transitions are tried in order, so number the guarded ones and call the last unguarded one "else". */
function labelTransition(
  transition: RawWorkflowTransition,
  index: number,
  all: readonly RawWorkflowTransition[],
): string {
  const status = String(transition.status).replace(MANUAL_STATUS_PREFIX, '');
  const siblings = all.filter((candidate) => candidate.status === transition.status);
  if (siblings.length === 1) return status;
  if (!isGuarded(transition)) return `${status} else`;
  const order = all
    .slice(0, index + 1)
    .filter((candidate) => candidate.status === transition.status && isGuarded(candidate)).length;
  return `${status} ${order}`;
}

export function resolvePorts(step: AuthoredStep): PortState {
  if (step.type === STEP_TYPE.custom) {
    return {
      kind: 'known',
      ports: readTransitions(step).map((transition, index, all) => ({
        name: toTransitionPort(index),
        // A target-less transition keeps the onboarding on this step; nothing to wire.
        optional: transition.target === undefined,
        label: labelTransition(transition, index, all),
        detail: describeGuard(transition),
      })),
    };
  }
  const definition = findStepType(step.type);
  if (definition === undefined) return { kind: 'unknown-type' };
  try {
    return {
      kind: 'known',
      ports: definition.listPorts(definition.parseConfig(step.config, throwReason)),
    };
  } catch (error) {
    return { kind: 'config-error', message: error instanceof Error ? error.message : 'Bad config' };
  }
}

function describeFields(fields: Record<string, unknown>): SectionField[] {
  return Object.entries(fields).map(([name, field]) => ({
    name,
    type: String(isPlainObject(field) ? field.type : undefined),
    required: isPlainObject(field) && field.required === true,
  }));
}

/** The normalizer's rule for `acceptedWhen`: a boolean the step persists. */
function listStoredBooleans(data: Record<string, RawWorkflowField>): string[] {
  return Object.entries(data)
    .filter(([, field]) => field.type === FIELD_TYPE.boolean && field.persist !== false)
    .map(([name]) => name);
}

/** Of `stored`, the ones a `consents` section builds, or all of them on a `custom` step, plus any `named` already. */
function listAgreementFields(
  step: AuthoredStep,
  stored: readonly string[],
  named: readonly string[],
): string[] {
  if (step.type === STEP_TYPE.custom) return [...stored];
  const consentFields = new Set(
    listSections(step)
      .filter((section) => section.type === STEP_TYPE.consents)
      .flatMap((section) => (Array.isArray(section.fields) ? section.fields : []))
      .map((field) => field.name),
  );
  return stored.filter((field) => consentFields.has(field) || named.includes(field));
}

function buildSectionFields(type: string, config: StepConfig | undefined): StepSection['fields'] {
  const definition = findStepType(type);
  if (definition === undefined) return { error: `Unknown type ${type}` };
  // A custom step carries its compiled fields verbatim under `config.data`.
  if (type === STEP_TYPE.custom) {
    return describeFields(isPlainObject(config?.data) ? config.data : {});
  }
  try {
    return describeFields(definition.buildFields(definition.parseConfig(config, throwReason)));
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Bad config' };
  }
}

/** The step's own type first, then each `include`, each with the fields it builds from its config. */
export function listSections(step: AuthoredStep): StepSection[] {
  return [
    {
      type: step.type,
      include: null,
      config: step.config ?? {},
      fields: buildSectionFields(step.type, step.config),
    },
    ...(step.include ?? []).map((include, index) => ({
      type: include.type,
      include: index,
      config: include.config ?? {},
      fields: buildSectionFields(include.type, include.config),
    })),
  ];
}

/** Whether a step of this type takes its own `scoring` rules; `terminal` and `risk-score` do not. */
export function acceptsScoring(type: string): boolean {
  const definition = findStepType(type);
  if (definition === undefined) return false;
  // The rules' sub-step does not depend on config, so an empty one stands in for a broken one.
  return definition.resolveScoringStepKey === undefined
    ? true
    : definition.resolveScoringStepKey({}) !== undefined;
}

/** Types another step may list under `include`: they add fields, never ports or connectors. */
export function listComposableTypes(): string[] {
  return listStepTypes()
    .filter((definition) => definition.composable === true)
    .map((definition) => definition.type);
}

/** The composable types `step` may still include: each section type, its own included, appears once. */
export function listIncludableTypes(step: AuthoredStep): string[] {
  const present = new Set([step.type, ...(step.include ?? []).map((include) => include.type)]);
  return listComposableTypes().filter((type) => !present.has(type));
}

function readConnectorId(step: AuthoredStep): string | null {
  const config = step.config ?? {};
  const { connector, connectors } = config;
  if (isPlainObject(connector)) {
    if (typeof connector.id === 'string') return connector.id;
    if (typeof connector.name === 'string') return connector.name;
  }
  const first: unknown = Array.isArray(connectors) ? connectors[0] : undefined;
  return isPlainObject(first) && typeof first.id === 'string' ? first.id : null;
}

function countFields(step: AuthoredStep): number | null {
  let count = 0;
  for (const section of listSections(step)) {
    if (!Array.isArray(section.fields)) return null;
    count += section.fields.length;
  }
  return count;
}

function pickStatus(step: AuthoredStep): string {
  if (step.type === STEP_TYPE.custom && typeof step.config?.status === 'string') {
    return step.config.status;
  }
  return step.type === STEP_TYPE.manualReview
    ? WORKFLOW_STATUS.awaitingManualReview
    : WORKFLOW_STATUS.awaitingUser;
}

function summarize(step: AuthoredStep): string {
  if (step.type === STEP_TYPE.terminal) return `terminal · ${String(step.config?.outcome ?? '?')}`;
  if (step.type === STEP_TYPE.custom && isTerminalStatus(step.config?.status)) {
    return `terminal · ${String(step.config?.status)}`;
  }
  const connector = readConnectorId(step);
  if (connector !== null) return connector;
  const status = pickStatus(step);
  const fields = countFields(step);
  return fields === null || fields === 0 ? status : `${status} · ${pluralize(fields, 'field')}`;
}

/** Compiled step name → the authored step it comes from, so a `custom` target can name a typed step's sub-step. */
function mapCompiledNames(steps: readonly AuthoredStep[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const step of steps) {
    for (const compiled of listCompiledNames(step)) map.set(compiled, step.name);
  }
  return map;
}

/** Every step with a path into `target`, as the compiler scopes a step's contract. */
function listAncestors(target: string, predecessors: Map<string, string[]>): Set<string> {
  const ancestors = new Set<string>();
  const queue = [target];
  for (const name of queue) {
    for (const predecessor of predecessors.get(name) ?? []) {
      if (!ancestors.has(predecessor)) {
        ancestors.add(predecessor);
        queue.push(predecessor);
      }
    }
  }
  return ancestors;
}

/** Steps reachable from the initial one along wired edges (a `custom` step's transitions are edges too). */
function listReachable(initial: string | undefined, edges: readonly ProjectedEdge[]): Set<string> {
  const next = new Map<string, string[]>();
  for (const edge of edges) next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
  const reached = new Set<string>();
  const queue = initial === undefined ? [] : [initial];
  for (const name of queue) {
    if (reached.has(name)) continue;
    reached.add(name);
    queue.push(...(next.get(name) ?? []));
  }
  return reached;
}

type StepBase = Omit<
  ProjectedStep,
  'summary' | 'storedFields' | 'agreementFields' | 'issues' | 'duplicateFields'
>;

function projectEdges(
  step: AuthoredStep,
  names: ReadonlySet<string>,
  authoredByCompiled: ReadonlyMap<string, string>,
): { edges: ProjectedEdge[]; unfinished: string[] } {
  const edges: ProjectedEdge[] = [];
  const unfinished = new Set<string>();

  readTransitions(step).forEach((transition, index) => {
    const port = toTransitionPort(index);
    if (transition.target === undefined) return;
    if (transition.target === UNWIRED) {
      unfinished.add(port);
      return;
    }
    const target = authoredByCompiled.get(transition.target) ?? transition.target;
    const guard = describeGuard(transition);
    edges.push({
      id: `${step.name}:${port}:0`,
      source: step.name,
      port,
      armIndex: null,
      handle: port,
      target,
      label: guard,
      condition: guard.replace(/^when /, ''),
      dangling: !names.has(target),
    });
  });

  for (const [port, edge] of Object.entries(step.edges ?? {})) {
    const arms = readArms(step, port);
    // The schema's `stepEdge` needs at least one arm, so an empty list is no wiring at all.
    if (arms.length === 0) unfinished.add(port);
    arms.forEach((arm, armIndex) => {
      if (arm.target === UNWIRED) {
        unfinished.add(port);
        return;
      }
      const condition = arm.when === undefined ? '' : describeCondition(arm.when);
      edges.push({
        id: `${step.name}:${port}:${armIndex}`,
        source: step.name,
        port,
        armIndex: typeof edge === 'string' ? null : armIndex,
        handle: isBranched(edge) ? toArmHandle(port, armIndex) : port,
        target: arm.target,
        label: condition ? `${port} · when ${condition}` : port,
        // A branch is labelled on its own handle, so the line itself carries no text.
        condition: '',
        dangling: !names.has(arm.target),
      });
    });
  }
  return { edges, unfinished: [...unfinished] };
}

/** Names the failing settings when the schema check finds them; a rule only `parseConfig` knows keeps its code. */
function describeConfigError(step: AuthoredStep, message: string): string {
  const failures = Object.entries(checkStepConfig(step.type, step.config ?? {}));
  if (failures.length === 0) return `invalid config: ${message}`;
  return `invalid config: ${failures.map(([path, reason]) => `${path} (${reason})`).join(', ')}`;
}

function listIssues(
  projected: StepBase,
  extra: {
    reached: boolean;
    danglingTargets: string[];
    duplicateFields: ReadonlyMap<string, string[]>;
    declaredScores: ReadonlySet<string>;
    agreements: readonly Agreement[];
    storedBooleans: readonly string[] | null;
    missingMappings: readonly string[];
  },
): string[] {
  const { step, ports } = projected;
  const issues: string[] = [];
  if (!extra.reached) issues.push('unreachable from the initial step');
  if (ports.kind === 'unknown-type') issues.push(`unknown type ${step.type}`);
  if (ports.kind === 'config-error') issues.push(describeConfigError(step, ports.message));
  if (ports.kind === 'known') {
    const required = projected.unwired.filter(
      (port) => !ports.ports.find((candidate) => candidate.name === port)?.optional,
    );
    if (required.length > 0) issues.push(`unwired: ${required.join(', ')}`);
  }
  if (projected.unfinished.length > 0) issues.push(`no target: ${projected.unfinished.join(', ')}`);
  if (projected.strayPorts.length > 0) {
    issues.push(`no such port: ${projected.strayPorts.join(', ')}`);
  }
  if (extra.danglingTargets.length > 0) {
    issues.push(`points to missing ${extra.danglingTargets.join(', ')}`);
  }
  for (const section of listSections(step)) {
    if (!Array.isArray(section.fields) && section.include !== null) {
      issues.push(`invalid ${section.type} section: ${section.fields.error}`);
    }
  }
  for (const [field, others] of extra.duplicateFields) {
    issues.push(`field ${field} is also created by ${others.join(', ')}`);
  }
  const undeclared = [...new Set(listScoringRules(step).map((rule) => rule.score))].filter(
    (score) => !extra.declaredScores.has(score),
  );
  if (undeclared.length > 0)
    issues.push(`scoring names undeclared score: ${undeclared.join(', ')}`);
  for (const agreement of extra.agreements) {
    if (agreement.acceptedWhen === '') issues.push(`agreement ${agreement.key} names no field`);
    else if (
      extra.storedBooleans !== null &&
      !extra.storedBooleans.includes(agreement.acceptedWhen)
    )
      issues.push(
        `agreement ${agreement.key}: ${agreement.acceptedWhen} is not a stored yes/no field`,
      );
  }
  issues.push(...extra.missingMappings);
  if (projected.isInitial && step.type === STEP_TYPE.terminal) {
    issues.push('initial step cannot be terminal');
  }
  return issues;
}

/** Root fields a step declares itself, read where it does not compile and stores nothing known. */
function listDeclaredFields(step: AuthoredStep): string[] {
  const configs = [step.config, ...(step.include ?? []).map((include) => include.config)];
  return configs.flatMap((config) =>
    [config?.fields, config?.data].flatMap((fields) =>
      isPlainObject(fields) ? Object.keys(fields) : [],
    ),
  );
}

/** Every connector mapping of the step, fallbacks included, whose field no step of the workflow stores. */
function listMissingMappings(
  preview: CompiledPreview | undefined,
  knownFields: ReadonlySet<string>,
): string[] {
  if (preview?.kind !== 'compiled') return [];
  const issues = new Set<string>();
  for (const compiled of preview.steps) {
    for (const connector of compiled.connectors ?? []) {
      for (const declaration of [connector, ...(connector.fallback ?? [])]) {
        for (const mapping of [declaration.fieldMapping, declaration.optionalFieldMapping]) {
          for (const [key, field] of Object.entries(mapping ?? {})) {
            if (!knownFields.has(field)) issues.add(`payload ${key} reads missing field ${field}`);
          }
        }
      }
    }
  }
  return [...issues];
}

/** Problems no one step owns; they are fixed in Workflow settings. */
function listWorkflowIssues(doc: AuthoredDocument, names: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  if (doc.initial !== undefined && !names.has(doc.initial)) {
    issues.push(`initial step points to missing ${doc.initial}`);
  }
  for (const agreement of doc.agreements ?? []) {
    if (!names.has(agreement.step)) {
      issues.push(`agreement ${agreement.key} points to missing ${agreement.step}`);
    }
  }
  return issues;
}

/** Every field the steps store, in step order, each once with the steps that store it. */
function listWorkflowFields(steps: readonly ProjectedStep[]): WorkflowField[] {
  const fields = new Map<string, WorkflowField>();
  for (const { step, storedFields } of steps) {
    // A step that does not compile still offers the fields its config declares, untyped.
    const own = storedFields ?? listDeclaredFields(step).map((name) => ({ name, type: null }));
    for (const { name, type } of own) {
      const field = fields.get(name);
      if (field === undefined) fields.set(name, { name, type, steps: [step.name] });
      else if (!field.steps.includes(step.name)) field.steps.push(step.name);
    }
  }
  return [...fields.values()];
}

function listWorkflowScores(doc: AuthoredDocument): WorkflowScore[] {
  return Object.entries(doc.scoring ?? {}).map(([name, { min, max }]) => ({ name, min, max }));
}

export function projectDocument(doc: AuthoredDocument): {
  steps: ProjectedStep[];
  edges: ProjectedEdge[];
  workflowIssues: string[];
  contents: WorkflowContents;
} {
  const names = new Set(doc.steps.map((step) => step.name));
  const initial = doc.initial ?? doc.steps[0]?.name;
  const categories = new Map(listStepTypes().map((type) => [type.type, type.category]));
  const authoredByCompiled = mapCompiledNames(doc.steps);
  const edges: ProjectedEdge[] = [];

  const bases = doc.steps.map((step, index): StepBase => {
    const ports = resolvePorts(step);
    const own = projectEdges(step, names, authoredByCompiled);
    edges.push(...own.edges);
    const wired = step.edges ?? {};
    const portNames = ports.kind === 'known' ? ports.ports.map((port) => port.name) : [];
    return {
      step,
      index,
      category: categories.get(step.type) ?? null,
      ports,
      unwired: step.type === STEP_TYPE.custom ? [] : portNames.filter((port) => !(port in wired)),
      unfinished: own.unfinished,
      strayPorts:
        ports.kind === 'known' ? Object.keys(wired).filter((key) => !portNames.includes(key)) : [],
      isInitial: step.name === initial,
    };
  });

  // Ancestors come from edges only, as in the compiler: a custom step's transitions feed no contract.
  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    if (readTransitionIndex(edge.port) !== null) continue;
    predecessors.set(edge.target, [...(predecessors.get(edge.target) ?? []), edge.source]);
  }
  const previews = compilePreviews(doc.steps, (name) => listAncestors(name, predecessors));
  const owners = mapFieldOwners(previews);
  const knownFields = new Set([
    ...owners.keys(),
    ...doc.steps
      .filter((step) => previews.get(step.name)?.kind !== 'compiled')
      .flatMap(listDeclaredFields),
  ]);
  const reached = listReachable(initial, edges);
  const declaredScores = new Set(Object.keys(doc.scoring ?? {}));

  const steps = bases.map((base): ProjectedStep => {
    const name = base.step.name;
    const preview = previews.get(name);
    const duplicateFields = new Map<string, string[]>();
    for (const [field, by] of owners) {
      if (by.length > 1 && by.includes(name)) {
        // The other owners; this step itself when it creates the field twice.
        const others = by.filter((owner) => owner !== name);
        duplicateFields.set(field, others.length > 0 ? others : [name]);
      }
    }
    const entry = preview?.kind === 'compiled' ? preview.steps[0] : undefined;
    const agreements = (doc.agreements ?? []).filter((agreement) => agreement.step === name);
    const storedBooleans = entry === undefined ? null : listStoredBooleans(entry.data);
    const agreementFields =
      storedBooleans === null
        ? null
        : listAgreementFields(
            base.step,
            storedBooleans,
            agreements.map((agreement) => agreement.acceptedWhen),
          );
    const danglingTargets = edges
      .filter((edge) => edge.source === name && edge.dangling)
      .map((edge) => edge.target);
    return {
      ...base,
      summary: summarize(base.step),
      storedFields:
        preview?.kind === 'compiled'
          ? preview.steps.flatMap((compiled) => describeFields(compiled.data))
          : null,
      agreementFields,
      issues: listIssues(base, {
        reached: reached.has(name),
        danglingTargets,
        duplicateFields,
        declaredScores,
        agreements,
        storedBooleans,
        missingMappings: listMissingMappings(preview, knownFields),
      }),
      duplicateFields,
    };
  });

  return {
    steps,
    edges,
    workflowIssues: listWorkflowIssues(doc, names),
    contents: { fields: listWorkflowFields(steps), scores: listWorkflowScores(doc) },
  };
}

/** Edges that loop back to a step already on the path from `initial`, walked depth-first. */
export function listBackEdges(
  steps: readonly ProjectedStep[],
  edges: readonly ProjectedEdge[],
): Set<string> {
  const outgoing = new Map<string, ProjectedEdge[]>();
  for (const projected of steps) {
    const order =
      projected.ports.kind === 'known' ? projected.ports.ports.map((port) => port.name) : [];
    const own = edges.filter((edge) => edge.source === projected.step.name && !edge.dangling);
    own.sort((a, b) => order.indexOf(a.port) - order.indexOf(b.port));
    outgoing.set(projected.step.name, own);
  }
  const back = new Set<string>();
  const done = new Set<string>();
  const onPath = new Set<string>();
  const visit = (name: string): void => {
    onPath.add(name);
    for (const edge of outgoing.get(name) ?? []) {
      if (onPath.has(edge.target)) back.add(edge.id);
      else if (!done.has(edge.target)) visit(edge.target);
    }
    onPath.delete(name);
    done.add(name);
  };
  const initial = steps.find((projected) => projected.isInitial);
  if (initial !== undefined) visit(initial.step.name);
  for (const projected of steps) if (!done.has(projected.step.name)) visit(projected.step.name);
  return back;
}
