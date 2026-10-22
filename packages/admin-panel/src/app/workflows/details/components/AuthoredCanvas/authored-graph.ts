// PoC (throwaway): the authored workflow document as a graph, plus the edits a canvas makes to it.
import { findStepType, listStepTypes } from '@tsh/ddl-schema/step-types/step-type.registry';
import { UNSAFE_NAMES } from '@tsh/ddl-schema/workflow-contract';
import { compileSteps, findFieldOwners } from './compiled-preview';
import type {
  WorkflowStepCategory,
  WorkflowStepPort,
} from '@tsh/ddl-schema/step-types/step-type.port';

export type Json = Record<string, unknown>;

export interface AuthoredArm {
  when?: unknown;
  target: string;
}

export interface AuthoredStep extends Json {
  name: string;
  type: string;
  config?: Json;
  include?: Json[];
  edges?: Record<string, string | AuthoredArm[]>;
  meta?: Json;
}

export interface AuthoredDocument extends Json {
  initial?: string;
  steps: AuthoredStep[];
}

/** A port as the canvas draws it; a `custom` step's transitions become ports with a display label. */
export type CanvasPort = WorkflowStepPort & { label?: string; detail?: string };

export type PortState =
  | { kind: 'known'; ports: readonly CanvasPort[] }
  | { kind: 'config-error'; message: string }
  | { kind: 'unknown-type' };

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
  /** The Graph tab's detail line, from the authored step: outcome, connector, or status and field count. */
  summary: string;
  /** Why the step cannot run as written; empty when it can. */
  issues: string[];
  /** Fields its compiled steps create that another step (or another of its sub-steps) also creates, with those owners. */
  duplicateFields: Map<string, string[]>;
};

export interface ProjectedEdge {
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
}

export function parseDocument(text: string): AuthoredDocument | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'The document is not a JSON object.';
  }
  const steps = (value as Json).steps;
  if (!Array.isArray(steps)) return 'The document has no `steps` array.';
  return value as AuthoredDocument;
}

function failer(reason: string, path?: unknown): never {
  throw new Error(path === undefined ? reason : `${reason} at ${String(path)}`);
}

export const CUSTOM_TYPE = 'custom';
/** The target an unwired arm or transition keeps, so its condition survives until it is rewired. */
export const UNWIRED = '';
const TRANSITION_PORT_PREFIX = 'transition-';
const ARM_HANDLE_SEPARATOR = '#';
const MANUAL_STATUS_PREFIX = 'manual.';

export interface CustomTransition extends Json {
  status: string;
  target?: string;
  when?: unknown;
  reason?: string[];
}

/** A `custom` step routes through `config.transitions`, each naming a compiled step as its target. */
export function readTransitions(step: AuthoredStep): CustomTransition[] {
  const transitions = step.config?.transitions;
  return step.type === CUSTOM_TYPE && Array.isArray(transitions)
    ? (transitions as CustomTransition[])
    : [];
}

/** A port with at least one condition: each of its arms gets a handle of its own. */
export function isBranched(edge: string | AuthoredArm[] | undefined): edge is AuthoredArm[] {
  return Array.isArray(edge) && edge.some((arm) => arm.when !== undefined);
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

function describeTransition(transition: CustomTransition): string {
  return [
    transition.when !== undefined ? `when ${describeCondition(transition.when)}` : null,
    transition.reason?.length ? `reason ${transition.reason.join(', ')}` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

export function resolvePorts(step: AuthoredStep): PortState {
  if (step.type === CUSTOM_TYPE) {
    return {
      kind: 'known',
      ports: readTransitions(step).map((transition, index, all) => {
        const status = String(transition.status).replace(MANUAL_STATUS_PREFIX, '');
        const isConditional = (candidate: CustomTransition): boolean =>
          candidate.when !== undefined || Boolean(candidate.reason?.length);
        const siblings = all.filter((candidate) => candidate.status === transition.status);
        // Transitions are tried in order, so number the guarded ones and call the last unguarded one "else".
        const order = all
          .slice(0, index + 1)
          .filter(
            (candidate) => candidate.status === transition.status && isConditional(candidate),
          ).length;
        const label =
          siblings.length === 1
            ? status
            : isConditional(transition)
              ? `${status} ${order}`
              : `${status} else`;
        return {
          name: toTransitionPort(index),
          // A target-less transition keeps the onboarding on this step; nothing to wire.
          optional: transition.target === undefined,
          label,
          detail: describeTransition(transition),
        };
      }),
    };
  }
  const definition = findStepType(step.type);
  if (definition === undefined) return { kind: 'unknown-type' };
  try {
    const config = definition.parseConfig(step.config, failer);
    return { kind: 'known', ports: definition.listPorts(config) };
  } catch (error) {
    return { kind: 'config-error', message: error instanceof Error ? error.message : 'Bad config' };
  }
}

const SCORE_SYMBOLS: Record<string, string> = { gte: '≥', gt: '>', lte: '≤', lt: '<' };

/** A condition as a short sentence: `kycOutcome = "verified" and risk ≥ 60`. */
export function describeCondition(when: unknown): string {
  if (typeof when !== 'object' || when === null) return '';
  const c = when as Json;
  const join = (items: unknown, word: string): string =>
    (Array.isArray(items) ? items : [])
      .map((item) => {
        const text = describeCondition(item);
        return /\b(and|or)\b/.test(text) ? `(${text})` : text;
      })
      .join(` ${word} `);
  if ('all' in c) return join(c.all, 'and');
  if ('any' in c) return join(c.any, 'or');
  if ('not' in c) return `not (${describeCondition(c.not)})`;
  if ('field' in c) {
    if ('equals' in c) return `${String(c.field)} = ${JSON.stringify(c.equals)}`;
    if ('in' in c) return `${String(c.field)} in ${(c.in as unknown[]).map(String).join(', ')}`;
    if ('isSet' in c) return `${String(c.field)} ${c.isSet ? 'is set' : 'is not set'}`;
  }
  if ('score' in c) {
    const op = Object.keys(SCORE_SYMBOLS).find((key) => key in c);
    return op ? `${String(c.score)} ${SCORE_SYMBOLS[op]} ${String(c[op])}` : String(c.score);
  }
  return '…';
}

/** Compiled step name → the authored step it comes from, so a `custom` target can name a typed step's sub-step. */
function mapCompiledNames(steps: AuthoredStep[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const step of steps) {
    for (const compiled of listCompiledNames(step)) map.set(compiled, step.name);
  }
  return map;
}

/** The step names an authored step compiles to: its own, then its sub-steps'. */
function listCompiledNames(step: AuthoredStep): string[] {
  const names = [step.name];
  const definition = step.type === CUSTOM_TYPE ? undefined : findStepType(step.type);
  if (definition === undefined) return names;
  try {
    const keys = definition.listSubStepKeys(definition.parseConfig(step.config, failer));
    const renames = (step.substeps ?? {}) as Record<string, string>;
    for (const key of keys) {
      if (key !== null) names.push(renames[key] ?? `${step.name}_${key}`);
    }
  } catch {
    // An invalid config lists no sub-steps; its entry name still counts.
  }
  return names;
}

export function projectDocument(doc: AuthoredDocument): {
  steps: ProjectedStep[];
  edges: ProjectedEdge[];
} {
  const names = new Set(doc.steps.map((step) => step.name));
  const initial = doc.initial ?? doc.steps[0]?.name;
  const categories = new Map(listStepTypes().map((type) => [type.type, type.category]));
  const edges: ProjectedEdge[] = [];

  const authoredByCompiled = mapCompiledNames(doc.steps);

  const steps = doc.steps.map((step, index) => {
    const ports = resolvePorts(step);
    const wired = step.edges ?? {};

    const unfinished = new Set<string>();
    readTransitions(step).forEach((transition, transitionIndex) => {
      if (transition.target === undefined) return;
      if (transition.target === UNWIRED) {
        unfinished.add(toTransitionPort(transitionIndex));
        return;
      }
      const target = authoredByCompiled.get(transition.target) ?? transition.target;
      const port = toTransitionPort(transitionIndex);
      edges.push({
        id: `${step.name}:${port}:0`,
        source: step.name,
        port,
        armIndex: null,
        handle: port,
        target,
        label: describeTransition(transition),
        condition: describeTransition(transition).replace(/^when /, ''),
        dangling: !names.has(target),
      });
    });
    const portNames = ports.kind === 'known' ? ports.ports.map((port) => port.name) : [];

    for (const [port, edge] of Object.entries(wired)) {
      const arms: AuthoredArm[] = typeof edge === 'string' ? [{ target: edge }] : edge;
      arms.forEach((arm, armIndex) => {
        if (arm.target === UNWIRED) {
          unfinished.add(port);
          return;
        }
        const condition = describeCondition(arm.when);
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

    return {
      step,
      index,
      category: categories.get(step.type) ?? null,
      ports,
      unwired: step.type === CUSTOM_TYPE ? [] : portNames.filter((port) => !(port in wired)),
      unfinished: [...unfinished],
      strayPorts:
        ports.kind === 'known' ? Object.keys(wired).filter((key) => !portNames.includes(key)) : [],
      isInitial: step.name === initial,
      summary: '',
      issues: [],
      duplicateFields: new Map<string, string[]>(),
    };
  });

  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    predecessors.set(edge.target, [...(predecessors.get(edge.target) ?? []), edge.source]);
  }
  const previews = compileSteps(doc.steps, (name) => findAncestors(name, predecessors));
  const owners = findFieldOwners(previews);
  for (const projected of steps) {
    const name = projected.step.name;
    for (const [field, by] of owners) {
      if (by.length > 1 && by.includes(name)) {
        // The other owners; this step itself when it creates the field twice.
        const others = by.filter((owner) => owner !== name);
        projected.duplicateFields.set(field, others.length > 0 ? others : [name]);
      }
    }
  }

  return { steps: describeSteps(steps, edges), edges };
}

const MANUAL_REVIEW_TYPE = 'manual-review';
const TERMINAL_TYPE = 'terminal';
const TERMINAL_STATUSES = new Set(['approved', 'rejected', 'invalid']);
/** Types whose connector the engine waits on asynchronously, and those whose connector can refuse. */
const ASYNC_CONNECTOR_TYPES = new Set(['kyc-identity-verification']);
const REJECTING_CONNECTOR_TYPES = new Set(['otp-verify']);

function readConnectorId(step: AuthoredStep): string | null {
  const config = step.config ?? {};
  const connector = config.connector as Json | undefined;
  if (typeof connector?.id === 'string') return connector.id;
  if (typeof connector?.name === 'string') return connector.name;
  const first = (config.connectors as Json[] | undefined)?.[0];
  return typeof first?.id === 'string' ? first.id : null;
}

function countFields(step: AuthoredStep): number | null {
  const sections = listSections(step);
  if (sections.some((section) => !Array.isArray(section.fields))) return null;
  return sections.reduce((sum, section) => sum + (section.fields as SectionField[]).length, 0);
}

function summarize(step: AuthoredStep): string {
  if (step.type === TERMINAL_TYPE) return `terminal · ${String(step.config?.outcome ?? '?')}`;
  if (step.type === CUSTOM_TYPE && TERMINAL_STATUSES.has(String(step.config?.status))) {
    return `terminal · ${String(step.config?.status)}`;
  }
  const connector = readConnectorId(step);
  if (connector !== null) {
    const canReject =
      REJECTING_CONNECTOR_TYPES.has(step.type) ||
      ((step.config?.connectors as Json[] | undefined) ?? []).some((entry) => entry.canReject);
    return [
      connector,
      ASYNC_CONNECTOR_TYPES.has(step.type) ||
      ((step.config?.connectors as Json[] | undefined) ?? []).some((entry) => entry.async)
        ? 'async'
        : null,
      canReject ? 'canReject' : null,
    ]
      .filter((part) => part !== null)
      .join(' · ');
  }
  const status =
    step.type === CUSTOM_TYPE && typeof step.config?.status === 'string'
      ? step.config.status
      : step.type === MANUAL_REVIEW_TYPE
        ? 'awaiting_manual_review'
        : 'awaiting_user';
  const fields = countFields(step);
  return fields === null || fields === 0
    ? status
    : `${status} · ${fields} ${fields === 1 ? 'field' : 'fields'}`;
}

/** Every step with a path into `target`, as the compiler scopes a step's contract. */
function findAncestors(target: string, predecessors: Map<string, string[]>): Set<string> {
  const ancestors = new Set<string>();
  const queue = [target];
  while (queue.length > 0) {
    for (const predecessor of predecessors.get(queue.shift()!) ?? []) {
      if (!ancestors.has(predecessor)) {
        ancestors.add(predecessor);
        queue.push(predecessor);
      }
    }
  }
  return ancestors;
}

/** Steps reachable from the initial one along wired edges (a `custom` step's transitions are edges too). */
function findReachable(steps: ProjectedStep[], edges: ProjectedEdge[]): Set<string> {
  const next = new Map<string, string[]>();
  for (const edge of edges) next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
  const reached = new Set<string>();
  const queue = steps.filter((step) => step.isInitial).map((step) => step.step.name);
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (reached.has(name)) continue;
    reached.add(name);
    queue.push(...(next.get(name) ?? []));
  }
  return reached;
}

function describeSteps(steps: ProjectedStep[], edges: ProjectedEdge[]): ProjectedStep[] {
  const reached = findReachable(steps, edges);
  return steps.map((projected) => {
    const { step, ports } = projected;
    const issues: string[] = [];
    if (!reached.has(step.name)) issues.push('unreachable from the initial step');
    if (ports.kind === 'unknown-type') issues.push(`unknown type ${step.type}`);
    if (ports.kind === 'config-error') issues.push(`invalid config: ${ports.message}`);
    if (ports.kind === 'known') {
      const required = projected.unwired.filter(
        (port) => !ports.ports.find((candidate) => candidate.name === port)?.optional,
      );
      if (required.length > 0) issues.push(`unwired: ${required.join(', ')}`);
    }
    if (projected.unfinished.length > 0)
      issues.push(`no target: ${projected.unfinished.join(', ')}`);
    if (projected.strayPorts.length > 0)
      issues.push(`no such port: ${projected.strayPorts.join(', ')}`);
    const dangling = edges.filter((edge) => edge.source === step.name && edge.dangling);
    if (dangling.length > 0)
      issues.push(`points to missing ${dangling.map((edge) => edge.target).join(', ')}`);
    for (const section of listSections(step)) {
      if (!Array.isArray(section.fields) && section.include !== null) {
        issues.push(`invalid ${section.type} section: ${section.fields.error}`);
      }
    }
    for (const [field, others] of projected.duplicateFields) {
      issues.push(`field ${field} is also created by ${others.join(', ')}`);
    }
    if (projected.isInitial && step.type === TERMINAL_TYPE)
      issues.push('initial step cannot be terminal');
    return { ...projected, summary: summarize(step), issues };
  });
}

// ---- Edits. Each returns a new document; the caller serialises it back into the editor text.

function mapSteps(
  doc: AuthoredDocument,
  fn: (step: AuthoredStep) => AuthoredStep,
): AuthoredDocument {
  return { ...doc, steps: doc.steps.map(fn) };
}

/** A `custom` step with its transitions rewritten; `null` from `fn` drops that transition. */
function mapTransitions(
  step: AuthoredStep,
  fn: (transition: CustomTransition, index: number) => CustomTransition | null,
): AuthoredStep {
  if (step.type !== CUSTOM_TYPE || !Array.isArray(step.config?.transitions)) return step;
  const transitions = readTransitions(step)
    .map(fn)
    .filter((transition): transition is CustomTransition => transition !== null);
  return { ...step, config: { ...step.config, transitions } };
}

/**
 * Wires a handle of `source` to `target`. A branch handle sets that branch; a port's own handle fills
 * its first unwired arm, else replaces what it pointed at.
 */
export function connect(
  doc: AuthoredDocument,
  source: string,
  port: string,
  target: string,
): AuthoredDocument {
  const transitionIndex = readTransitionIndex(port);
  const branch = readArmHandle(port);
  return mapSteps(doc, (step) => {
    if (step.name !== source) return step;
    if (branch !== null) {
      const arms = readArms(step, branch.port).map((arm, index) =>
        index === branch.armIndex ? { ...arm, target } : arm,
      );
      return { ...step, edges: { ...step.edges, [branch.port]: arms } };
    }
    if (transitionIndex !== null) {
      return mapTransitions(step, (transition, index) =>
        index === transitionIndex ? { ...transition, target } : transition,
      );
    }
    const current = step.edges?.[port];
    const empty = Array.isArray(current) ? current.findIndex((arm) => arm.target === UNWIRED) : -1;
    if (Array.isArray(current) && empty !== -1) {
      const arms = current.map((arm, index) => (index === empty ? { ...arm, target } : arm));
      return { ...step, edges: { ...step.edges, [port]: arms } };
    }
    return { ...step, edges: { ...step.edges, [port]: target } };
  });
}

/** A port's arms; a plain edge is one arm with no condition, an unwired port none. */
export function readArms(step: AuthoredStep, port: string): AuthoredArm[] {
  const edge = step.edges?.[port];
  if (edge === undefined) return [];
  return typeof edge === 'string' ? [{ target: edge }] : edge;
}

/**
 * Writes a port's arms back in the plainest form: none unwires it, a lone arm with no condition is a
 * plain edge, anything else stays a list. The caller keeps the fallback (no `when`) last.
 */
export function setArms(
  doc: AuthoredDocument,
  name: string,
  port: string,
  arms: AuthoredArm[],
): AuthoredDocument {
  return mapSteps(doc, (step) => {
    if (step.name !== name) return step;
    const edges = { ...step.edges };
    if (arms.length === 0) delete edges[port];
    else if (arms.length === 1 && arms[0]!.when === undefined) edges[port] = arms[0]!.target;
    else edges[port] = arms;
    return { ...step, edges };
  });
}

export function disconnect(
  doc: AuthoredDocument,
  source: string,
  port: string,
  armIndex: number | null,
): AuthoredDocument {
  const transitionIndex = readTransitionIndex(port);
  return mapSteps(doc, (step) => {
    if (step.name !== source) return step;
    // A transition or an arm keeps its condition and loses only its target.
    if (transitionIndex !== null) {
      return mapTransitions(step, (transition, index) =>
        index === transitionIndex ? { ...transition, target: UNWIRED } : transition,
      );
    }
    if (step.edges === undefined) return step;
    const edges = { ...step.edges };
    const current = edges[port];
    if (armIndex === null || typeof current === 'string' || current === undefined) {
      delete edges[port];
    } else {
      edges[port] = current.map((arm, index) =>
        index === armIndex ? { ...arm, target: UNWIRED } : arm,
      );
    }
    return { ...step, edges };
  });
}

/** Removes the step and unwires everything that targeted it; arms and transitions keep their conditions. */
export function deleteStep(doc: AuthoredDocument, name: string): AuthoredDocument {
  const unwire = (target: string): string => (target === name ? UNWIRED : target);
  const steps = doc.steps
    .filter((step) => step.name !== name)
    .map((step) =>
      mapTransitions(step, (transition) =>
        transition.target === name ? { ...transition, target: UNWIRED } : transition,
      ),
    )
    .map((step) => {
      if (step.edges === undefined) return step;
      const edges: NonNullable<AuthoredStep['edges']> = {};
      for (const [port, edge] of Object.entries(step.edges)) {
        if (typeof edge === 'string') {
          if (edge !== name) edges[port] = edge;
        } else {
          edges[port] = edge.map((arm) => ({ ...arm, target: unwire(arm.target) }));
        }
      }
      return { ...step, edges };
    });
  const next: AuthoredDocument = { ...doc, steps };
  if (doc.initial === name) delete next.initial;
  return next;
}

/** Renames a step and every reference to it: edges, `initial`, agreements. */
export function renameStep(doc: AuthoredDocument, from: string, to: string): AuthoredDocument {
  const rename = (target: string): string => (target === from ? to : target);
  const steps = doc.steps.map((step) => {
    const edges = step.edges
      ? Object.fromEntries(
          Object.entries(step.edges).map(([port, edge]) => [
            port,
            typeof edge === 'string'
              ? rename(edge)
              : edge.map((arm) => ({ ...arm, target: rename(arm.target) })),
          ]),
        )
      : undefined;
    const renamed = mapTransitions(step, (transition) =>
      transition.target === undefined
        ? transition
        : { ...transition, target: rename(transition.target) },
    );
    return {
      ...renamed,
      name: rename(step.name),
      ...(edges ? { edges } : {}),
    };
  });
  const next: AuthoredDocument = { ...doc, steps };
  if (doc.initial === from) next.initial = to;
  if (Array.isArray(doc.agreements)) {
    next.agreements = (doc.agreements as Json[]).map((agreement) =>
      agreement.step === from ? { ...agreement, step: to } : agreement,
    );
  }
  return next;
}

/** The schema's step-name rule (`STEP_NAME_PATTERN` in ddl-schema). */
const STEP_NAME = /^[A-Za-z0-9_-]+$/;

/** Why `from` cannot be renamed to `to`, or `null` when it can; checks compiled sub-step names too. */
export function findRenameProblem(doc: AuthoredDocument, from: string, to: string): string | null {
  if (to === '') return 'A step needs a name';
  if (!STEP_NAME.test(to)) return 'Use only letters, digits, _ and -';
  if (UNSAFE_NAMES.includes(to)) return `${to} is a reserved name`;
  const seen = new Map<string, string>();
  for (const step of renameStep(doc, from, to).steps) {
    for (const compiled of listCompiledNames(step)) {
      const owner = seen.get(compiled);
      if (owner !== undefined && (owner === to || step.name === to)) {
        return owner === step.name
          ? `${to} would compile two steps named ${compiled}`
          : `${compiled} is already a step name`;
      }
      seen.set(compiled, step.name);
    }
  }
  return null;
}

/**
 * Sets the document's own `keys` to their values in `edited`, unsetting any it leaves out. Keys keep
 * their place, so a settings edit is a small diff on the JSON tab; one set for the first time goes last.
 */
export function setRootKeys(
  doc: AuthoredDocument,
  keys: readonly string[],
  edited: Json,
): AuthoredDocument {
  const kept = Object.entries(doc).flatMap(([key, current]): [string, unknown][] =>
    !keys.includes(key) ? [[key, current]] : edited[key] === undefined ? [] : [[key, edited[key]]],
  );
  const added = keys.filter((key) => !(key in doc) && edited[key] !== undefined);
  return Object.fromEntries([
    ...kept,
    ...added.map((key) => [key, edited[key]]),
  ]) as AuthoredDocument;
}

export function setInitial(doc: AuthoredDocument, name: string): AuthoredDocument {
  return { ...doc, initial: name };
}

export function setConfig(doc: AuthoredDocument, name: string, config: Json): AuthoredDocument {
  return mapSteps(doc, (step) => (step.name === name ? { ...step, config } : step));
}

/** The canvas grid, in flow pixels: every node position the canvas writes lands on it. */
export const GRID_SIZE = 8;

export function snapToGrid(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.round(position.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(position.y / GRID_SIZE) * GRID_SIZE,
  };
}

export function setPosition(
  doc: AuthoredDocument,
  name: string,
  position: { x: number; y: number },
): AuthoredDocument {
  const rounded = snapToGrid(position);
  return mapSteps(doc, (step) =>
    step.name === name ? { ...step, meta: { ...step.meta, position: rounded } } : step,
  );
}

export function clearPositions(doc: AuthoredDocument): AuthoredDocument {
  return mapSteps(doc, (step) => {
    if (step.meta === undefined || !('position' in step.meta)) return step;
    const meta = Object.fromEntries(
      Object.entries(step.meta).filter(([key]) => key !== 'position'),
    );
    const next: AuthoredStep = { ...step, meta };
    if (Object.keys(meta).length === 0) delete (next as Partial<AuthoredStep>).meta;
    return next;
  });
}

/** Starter configs, so a new step of each type lists its ports at once. Taken from shipped workflows and specs. */
const STARTER_CONFIGS: Record<string, Json | undefined> = {
  form: { fields: {} },
  'contact-details': { email: 'required' },
  consents: { consents: [{ key: 'terms', acknowledgement: 'accepted' }] },
  'identity-profile': { nationalities: 'eea' },
  address: { countries: 'eea' },
  questionnaire: { sections: ['purpose'] },
  'document-choice': {
    documents: [
      { type: 'PASSPORT', countries: 'eea' },
      { type: 'ID_CARD', countries: 'eea-id-card-issuers' },
    ],
  },
  'document-capture': { document: 'PASSPORT' },
  'otp-verify': {
    channel: 'sms',
    connector: {
      id: 'twilio_verify',
      startConfig: { operation: 'startVerification' },
      checkConfig: { operation: 'checkVerification' },
    },
  },
  'kyc-identity-verification': {
    connector: { id: 'sumsub_kyc' },
    sourceKey: 'change_me',
    maxAttemptsPerDocSet: 3,
  },
  decision: {
    branches: [{ port: 'yes', when: { field: 'changeMe', isSet: true } }],
    fallback: true,
  },
  'risk-score': {
    rules: [{ score: 'risk', add: 10 }],
    bands: [{ port: 'high', score: 'risk', gte: 50 }],
    fallback: true,
  },
  'http-call': { request: { method: 'POST', url: 'https://example.internal/' } },
  notify: { connector: { id: 'sendgrid_email' }, recipientField: 'email' },
  'connector-call': { connectors: [] },
  'wait-for-external': { fields: {} },
  custom: { status: 'awaiting_user', data: {}, transitions: [] },
  terminal: { outcome: 'approved' },
};

/** A type's starter config; field names are unique across the workflow, so a starter field is named after `owner`. */
function buildStarterConfig(type: string, owner: string): Json | undefined {
  const config = STARTER_CONFIGS[type] ? structuredClone(STARTER_CONFIGS[type]) : undefined;
  if (config && 'fields' in config && Object.keys(config.fields as Json).length === 0) {
    config.fields = { [`${owner}_value`]: { type: 'text', required: true } };
  }
  return config;
}

export function addStep(
  doc: AuthoredDocument,
  type: string,
  position: { x: number; y: number },
): { doc: AuthoredDocument; name: string } {
  const base = type.replaceAll('-', '_');
  const taken = new Set(doc.steps.map((step) => step.name));
  let counter = 1;
  while (taken.has(`${base}_${counter}`)) counter += 1;
  const name = `${base}_${counter}`;
  const config = buildStarterConfig(type, name);
  const step: AuthoredStep = {
    name,
    type,
    ...(config ? { config } : {}),
    meta: { position: snapToGrid(position) },
  };
  return { doc: { ...doc, steps: [...doc.steps, step] }, name };
}

/**
 * Edges that loop back to a step already on the path from `initial` (retries). Walked depth-first
 * from the initial step in port order, then from any unreached step in document order, so the
 * forward flow is the authored one and only true loops are left out of layout.
 */
export function findBackEdges(steps: ProjectedStep[], edges: ProjectedEdge[]): Set<string> {
  const outgoing = new Map<string, ProjectedEdge[]>();
  for (const step of steps) {
    const order = step.ports.kind === 'known' ? step.ports.ports.map((port) => port.name) : [];
    const own = edges.filter((edge) => edge.source === step.step.name && !edge.dangling);
    own.sort((a, b) => order.indexOf(a.port) - order.indexOf(b.port));
    outgoing.set(step.step.name, own);
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
  const initial = steps.find((step) => step.isInitial);
  if (initial) visit(initial.step.name);
  for (const step of steps) if (!done.has(step.step.name)) visit(step.step.name);
  return back;
}

export interface SectionField {
  name: string;
  type: string;
  required: boolean;
}

/** One part of a step: its own type (`include: null`) or one of its included sections. */
export interface StepSection {
  type: string;
  include: number | null;
  config: Json;
  fields: SectionField[] | { error: string };
}

function buildSectionFields(type: string, config: Json | undefined): StepSection['fields'] {
  const definition = findStepType(type);
  if (definition === undefined) return { error: `Unknown type ${type}` };
  // A custom step carries its compiled fields verbatim under `config.data`.
  if (type === CUSTOM_TYPE) {
    return Object.entries((config?.data as Record<string, Json> | undefined) ?? {}).map(
      ([name, field]) => ({ name, type: String(field.type), required: field.required === true }),
    );
  }
  try {
    const parsed = definition.parseConfig(config, failer);
    return Object.entries(definition.buildFields(parsed)).map(([name, field]) => ({
      name,
      type: String(field.type),
      required: field.required === true,
    }));
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
    ...(step.include ?? []).map((include, index) => {
      const type = String(include.type);
      const config = (include.config as Json | undefined) ?? {};
      return { type, include: index, config, fields: buildSectionFields(type, config) };
    }),
  ];
}

/** What the engine fills in for each top-level config key left out: whatever `parseConfig` returns that the config does not set. */
export function readConfigDefaults(type: string, config: Json): Record<string, unknown> {
  const definition = findStepType(type);
  if (definition === undefined || type === CUSTOM_TYPE) return {};
  try {
    const parsed = definition.parseConfig(config, failer) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([key]) => !(key in config)));
  } catch {
    // An invalid config yields no defaults; the form still draws.
    return {};
  }
}

/** Types another step may list under `include`: they add fields, never ports or connectors. */
export function listComposableTypes(): string[] {
  return listStepTypes()
    .filter((type) => type.composable === true)
    .map((type) => type.type);
}

/** Appends an included section of `type` to the step, with the type's starter config. */
export function addInclude(doc: AuthoredDocument, name: string, type: string): AuthoredDocument {
  return mapSteps(doc, (step) => {
    if (step.name !== name) return step;
    const config = buildStarterConfig(type, `${name}_${type.replaceAll('-', '_')}`);
    const include = [...(step.include ?? []), { type, ...(config ? { config } : {}) }];
    return { ...step, include };
  });
}

/** Drops one included section; the schema refuses an empty `include`, so the last one takes the key with it. */
export function removeInclude(
  doc: AuthoredDocument,
  name: string,
  index: number,
): AuthoredDocument {
  return mapSteps(doc, (step) => {
    if (step.name !== name || step.include === undefined) return step;
    const include = step.include.filter((_, candidate) => candidate !== index);
    const next: AuthoredStep = { ...step, include };
    if (include.length === 0) delete next.include;
    return next;
  });
}

export function setSectionConfig(
  doc: AuthoredDocument,
  name: string,
  include: number | null,
  config: Json,
): AuthoredDocument {
  if (include === null) return setConfig(doc, name, config);
  return mapSteps(doc, (step) =>
    step.name === name
      ? {
          ...step,
          include: (step.include ?? []).map((entry, index) =>
            index === include ? { ...entry, config } : entry,
          ),
        }
      : step,
  );
}
