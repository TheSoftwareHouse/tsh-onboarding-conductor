import {
  EEA_ID_CARD_ISSUERS_PRESET,
  EEA_PRESET,
  OTP_CHANNEL,
  QUESTIONNAIRE_SECTIONS,
  STEP_TYPE,
  type StepTypeName,
} from '@tsh/ddl-schema/step-types';
import { getWorkflowJsonSchema } from '@tsh/ddl-schema/workflow-schema';
import {
  CUSTOM_CONNECTOR_TYPE,
  FIELD_TYPE,
  UNSAFE_NAMES,
  WORKFLOW_STATUS,
  type RawWorkflowScoringRule,
  type RawWorkflowTransition,
} from '@tsh/ddl-schema/workflow-contract';
import { buildSourceKey } from '../../utils/source-key';
import type { Agreement } from './agreements';
import {
  listCompiledNames,
  readArmHandle,
  readArms,
  readTransitionIndex,
  readTransitions,
  UNWIRED,
  type AuthoredArm,
  type AuthoredDocument,
  type AuthoredStep,
  type CanvasPosition,
} from './authored-document';
import { HTTP_REQUEST_METHOD } from './http-request-schema';
import { listIncludableTypes, projectDocument, type ProjectedStep } from './authored-projection';
import { isPlainObject } from './is-plain-object';

type StepConfig = Record<string, unknown>;
type StepEdges = NonNullable<AuthoredStep['edges']>;

/** The canvas grid, in flow pixels: every node position the canvas writes lands on it. */
export const GRID_SIZE = 8;

/** The schema's step-name rule, read from the schema so the two cannot disagree. */
function readStepNamePattern(): RegExp {
  const schema = getWorkflowJsonSchema() as {
    definitions: { step: { properties: { name: { allOf: { pattern?: string }[] } } } };
  };
  const pattern = schema.definitions.step.properties.name.allOf.find(
    (part) => part.pattern !== undefined,
  )?.pattern;
  if (pattern === undefined) throw new Error('The workflow schema has no step-name pattern');
  return new RegExp(pattern);
}

function mapSteps(
  doc: AuthoredDocument,
  fn: (step: AuthoredStep) => AuthoredStep,
): AuthoredDocument {
  return { ...doc, steps: doc.steps.map(fn) };
}

/** A `custom` step with its transitions rewritten. */
function mapTransitions(
  step: AuthoredStep,
  fn: (transition: RawWorkflowTransition, index: number) => RawWorkflowTransition,
): AuthoredStep {
  if (step.type !== STEP_TYPE.custom || !Array.isArray(step.config?.transitions)) return step;
  return { ...step, config: { ...step.config, transitions: readTransitions(step).map(fn) } };
}

/** Wires a handle of `source` to `target`: a branch handle sets that branch, a port fills its first unwired arm. */
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

/** Writes a port's arms back in the plainest form: none unwires, a lone plain arm is an edge. */
export function setArms(
  doc: AuthoredDocument,
  name: string,
  port: string,
  arms: AuthoredArm[],
): AuthoredDocument {
  return mapSteps(doc, (step) => {
    if (step.name !== name) return step;
    const edges = { ...step.edges };
    const [only] = arms;
    if (only === undefined) delete edges[port];
    else if (arms.length === 1 && only.when === undefined) edges[port] = only.target;
    else edges[port] = arms;
    return { ...step, edges };
  });
}

/** Writes a port's arms after a target was cleared; a lone arm left with nothing but its empty target removes the port. */
function writeClearedArms(edges: StepEdges, port: string, arms: AuthoredArm[]): void {
  const [only] = arms;
  const hollow = arms.length === 1 && only?.target === UNWIRED && Object.keys(only).length === 1;
  if (hollow) delete edges[port];
  else edges[port] = arms;
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
      writeClearedArms(
        edges,
        port,
        current.map((arm, index) => (index === armIndex ? { ...arm, target: UNWIRED } : arm)),
      );
    }
    return { ...step, edges };
  });
}

/** The step names `name` compiles to; a transition may target any of them. */
function listOwnCompiledNames(doc: AuthoredDocument, name: string): string[] {
  const owner = doc.steps.find((step) => step.name === name);
  return owner === undefined ? [name] : listCompiledNames(owner);
}

/** Removes the step and unwires everything that targeted it; arms and transitions keep their conditions. */
export function deleteStep(doc: AuthoredDocument, name: string): AuthoredDocument {
  const unwire = (target: string): string => (target === name ? UNWIRED : target);
  const compiledNames = listOwnCompiledNames(doc, name);
  const steps = doc.steps
    .filter((step) => step.name !== name)
    .map((step) =>
      mapTransitions(step, (transition) =>
        transition.target !== undefined && compiledNames.includes(transition.target)
          ? { ...transition, target: UNWIRED }
          : transition,
      ),
    )
    .map((step) => {
      if (step.edges === undefined) return step;
      const edges: StepEdges = {};
      for (const [port, edge] of Object.entries(step.edges)) {
        if (typeof edge === 'string') {
          if (edge !== name) edges[port] = edge;
        } else {
          const arms = edge.map((arm) => ({ ...arm, target: unwire(arm.target) }));
          if (edge.some((arm) => arm.target === name)) writeClearedArms(edges, port, arms);
          else edges[port] = arms;
        }
      }
      return { ...step, edges };
    });
  const next: AuthoredDocument = { ...doc, steps };
  if (doc.initial === name) delete next.initial;
  if (doc.agreements !== undefined) {
    const agreements = doc.agreements.filter((agreement) => agreement.step !== name);
    if (agreements.length === 0) delete next.agreements;
    else next.agreements = agreements;
  }
  return next;
}

/** Renames a step and every reference to it: edges, transitions (sub-steps too), `initial`, agreements. */
export function renameStep(doc: AuthoredDocument, from: string, to: string): AuthoredDocument {
  const rename = (target: string): string => (target === from ? to : target);
  const oldNames = listOwnCompiledNames(doc, from);
  const newNames = listOwnCompiledNames(renameOnly(doc, from, to), to);
  const renameCompiled = (target: string): string => newNames[oldNames.indexOf(target)] ?? target;
  const steps = doc.steps.map((step) => {
    const renamed = mapTransitions(step, (transition) =>
      transition.target === undefined
        ? transition
        : { ...transition, target: renameCompiled(transition.target) },
    );
    const edges =
      step.edges === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(step.edges).map(([port, edge]) => [
              port,
              typeof edge === 'string'
                ? rename(edge)
                : edge.map((arm) => ({ ...arm, target: rename(arm.target) })),
            ]),
          );
    return { ...renamed, name: rename(step.name), ...(edges ? { edges } : {}) };
  });
  const next: AuthoredDocument = { ...doc, steps };
  if (doc.initial === from) next.initial = to;
  if (doc.agreements !== undefined) {
    next.agreements = doc.agreements.map((agreement) =>
      agreement.step === from ? { ...agreement, step: to } : agreement,
    );
  }
  return next;
}

function renameOnly(doc: AuthoredDocument, from: string, to: string): AuthoredDocument {
  return mapSteps(doc, (step) => (step.name === from ? { ...step, name: to } : step));
}

type RenameName = (name: string) => string;

/** The condition with every field leaf renamed; score leaves pass through. */
function renameConditionFields<T>(condition: T, rename: RenameName): T {
  if (!isPlainObject(condition)) return condition;
  const next: Record<string, unknown> = { ...condition };
  if (Array.isArray(next.all))
    next.all = next.all.map((child) => renameConditionFields(child, rename));
  if (Array.isArray(next.any))
    next.any = next.any.map((child) => renameConditionFields(child, rename));
  if ('not' in next) next.not = renameConditionFields(next.not, rename);
  if (typeof next.field === 'string') next.field = rename(next.field);
  return next as T;
}

function renameWhen<T>(entry: T, rename: RenameName): T {
  if (!isPlainObject(entry) || entry.when === undefined) return entry;
  return { ...entry, when: renameConditionFields(entry.when, rename) };
}

/** A field map with the `when` of every descriptor renamed, nested and array-item descriptors included. */
function renameFieldMapConditions(fields: unknown, rename: RenameName): unknown {
  if (!isPlainObject(fields)) return fields;
  return Object.fromEntries(
    Object.entries(fields).map(([key, descriptor]) => [
      key,
      renameDescriptorConditions(descriptor, rename),
    ]),
  );
}

function renameDescriptorConditions(descriptor: unknown, rename: RenameName): unknown {
  if (!isPlainObject(descriptor)) return descriptor;
  const next = renameWhen(descriptor, rename);
  if ('fields' in next) next.fields = renameFieldMapConditions(next.fields, rename);
  if ('items' in next) next.items = renameDescriptorConditions(next.items, rename);
  return next;
}

function renameMappingValues(mapping: unknown, rename: RenameName): unknown {
  if (!isPlainObject(mapping)) return mapping;
  return Object.fromEntries(
    Object.entries(mapping).map(([key, value]) => [
      key,
      typeof value === 'string' ? rename(value) : value,
    ]),
  );
}

/** A connector declaration or binding with its mapping sources renamed, fallback entries included. */
function renameConnectorSources(connector: unknown, rename: RenameName): unknown {
  if (!isPlainObject(connector)) return connector;
  const next = { ...connector };
  if ('fieldMapping' in next) next.fieldMapping = renameMappingValues(next.fieldMapping, rename);
  if ('optionalFieldMapping' in next) {
    next.optionalFieldMapping = renameMappingValues(next.optionalFieldMapping, rename);
  }
  if (Array.isArray(next.fallback)) {
    next.fallback = next.fallback.map((entry) => renameConnectorSources(entry, rename));
  }
  return next;
}

/** Config members whose entries each may carry a `when`: decision, risk-score and custom. */
const CONDITIONED_LISTS = ['branches', 'rules', 'transitions', 'scoring'] as const;

/** Field references in a step or section config; `data` is a custom step's field map. */
function renameConfigReferences(config: StepConfig, rename: RenameName): StepConfig {
  const next = { ...config };
  if ('fields' in next) next.fields = renameFieldMapConditions(next.fields, rename);
  if ('data' in next) next.data = renameFieldMapConditions(next.data, rename);
  for (const key of CONDITIONED_LISTS) {
    const list = next[key];
    if (Array.isArray(list)) next[key] = list.map((entry) => renameWhen(entry, rename));
  }
  if (Array.isArray(next.connectors)) {
    next.connectors = next.connectors.map((entry) => renameConnectorSources(entry, rename));
  }
  if ('connector' in next) next.connector = renameConnectorSources(next.connector, rename);
  if (typeof next.recipientField === 'string') next.recipientField = rename(next.recipientField);
  return next;
}

function renameStepReferences(step: AuthoredStep, rename: RenameName): AuthoredStep {
  const next: AuthoredStep = { ...step };
  if (step.config !== undefined) next.config = renameConfigReferences(step.config, rename);
  if (step.include !== undefined) {
    next.include = step.include.map((entry) =>
      entry.config === undefined
        ? entry
        : { ...entry, config: renameConfigReferences(entry.config, rename) },
    );
  }
  if (step.scoring !== undefined)
    next.scoring = step.scoring.map((rule) => renameWhen(rule, rename));
  if (step.edges !== undefined) {
    next.edges = Object.fromEntries(
      Object.entries(step.edges).map(([port, edge]) => [
        port,
        typeof edge === 'string' ? edge : edge.map((arm) => renameWhen(arm, rename)),
      ]),
    );
  }
  return next;
}

/** An http-call's `fieldMapping` values are fields; its `{{payload.<key>}}` placeholders name payload keys and stay as written. */
function renameHttpCallReferences(step: AuthoredStep, rename: RenameName): AuthoredStep {
  const config = step.config;
  if (step.type !== STEP_TYPE.httpCall || config === undefined || !('fieldMapping' in config)) {
    return step;
  }
  return {
    ...step,
    config: { ...config, fieldMapping: renameMappingValues(config.fieldMapping, rename) },
  };
}

function declaresRootField(config: StepConfig | undefined, name: string): boolean {
  return [config?.fields, config?.data].some(
    (fields) => isPlainObject(fields) && Object.hasOwn(fields, name),
  );
}

/** A step that does not compile stores nothing known, so fall back to the fields it declares. */
function storesField(projected: ProjectedStep, name: string): boolean {
  if (projected.storedFields !== null) return projected.storedFields.some((f) => f.name === name);
  const { step } = projected;
  return [step.config, ...(step.include ?? []).map((entry) => entry.config)].some((config) =>
    declaresRootField(config, name),
  );
}

/** Renames a root field and its references; `referencesUpdated` is false when another step stores the same name. */
export function renameField(
  doc: AuthoredDocument,
  stepName: string,
  from: string,
  to: string,
): { doc: AuthoredDocument; referencesUpdated: boolean } {
  const owner = doc.steps.find((step) => step.name === stepName);
  const fields = owner?.config?.fields;
  if (owner === undefined || !isPlainObject(fields) || !Object.hasOwn(fields, from)) {
    return { doc, referencesUpdated: false };
  }
  const renamedFields = Object.fromEntries(
    Object.entries(fields).map(([key, descriptor]) => [key === from ? to : key, descriptor]),
  );
  const withKey = setConfig(doc, stepName, { ...owner.config, fields: renamedFields });
  const ambiguous = projectDocument(doc).steps.some(
    (projected) => projected.step.name !== stepName && storesField(projected, from),
  );
  if (ambiguous) return { doc: withKey, referencesUpdated: false };

  const rename: RenameName = (name) => (name === from ? to : name);
  const steps = withKey.steps.map((step) => {
    const next = renameHttpCallReferences(renameStepReferences(step, rename), rename);
    if (step.name !== stepName || next.config?.canonical === undefined) return next;
    return {
      ...next,
      config: { ...next.config, canonical: renameMappingValues(next.config.canonical, rename) },
    };
  });
  const next: AuthoredDocument = { ...withKey, steps };
  if (doc.agreements !== undefined) {
    next.agreements = doc.agreements.map((agreement) =>
      agreement.step === stepName
        ? { ...agreement, acceptedWhen: rename(agreement.acceptedWhen) }
        : agreement,
    );
  }
  return { doc: next, referencesUpdated: true };
}

/** Why `from` cannot be renamed to `to`, or `null` when it can; checks compiled sub-step names too. */
export function findRenameProblem(doc: AuthoredDocument, from: string, to: string): string | null {
  if (to === '') return 'A step needs a name';
  if (!readStepNamePattern().test(to)) return 'Use only letters, digits, _ and -';
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

/** Writes the root `agreements`, dropping the key when none are left. */
export function setAgreements(doc: AuthoredDocument, agreements: Agreement[]): AuthoredDocument {
  return setRootKeys(doc, ['agreements'], agreements.length > 0 ? { agreements } : {});
}

/** Sets the document's own `keys` to their values in `edited`, unsetting any it leaves out, in place. */
export function setRootKeys(
  doc: AuthoredDocument,
  keys: readonly (keyof AuthoredDocument)[],
  edited: Partial<AuthoredDocument>,
): AuthoredDocument {
  const owned: readonly string[] = keys;
  const editedValues: Record<string, unknown> = edited;
  const kept = Object.entries(doc).flatMap(([key, current]): [string, unknown][] => {
    if (!owned.includes(key)) return [[key, current]];
    return editedValues[key] === undefined ? [] : [[key, editedValues[key]]];
  });
  const added = owned
    .filter((key) => !(key in doc) && editedValues[key] !== undefined)
    .map((key): [string, unknown] => [key, editedValues[key]]);
  return Object.fromEntries([...kept, ...added]) as AuthoredDocument;
}

export function setInitial(doc: AuthoredDocument, name: string): AuthoredDocument {
  return { ...doc, initial: name };
}

export function setConfig(
  doc: AuthoredDocument,
  name: string,
  config: StepConfig,
): AuthoredDocument {
  return mapSteps(doc, (step) => (step.name === name ? { ...step, config } : step));
}

/** Writes a step's own scoring rules; the schema refuses an empty list, so none removes the key. */
export function setScoringRules(
  doc: AuthoredDocument,
  name: string,
  rules: RawWorkflowScoringRule[],
): AuthoredDocument {
  return mapSteps(doc, (step) => {
    if (step.name !== name) return step;
    if (rules.length > 0) return { ...step, scoring: rules };
    return Object.fromEntries(
      Object.entries(step).filter(([key]) => key !== 'scoring'),
    ) as AuthoredStep;
  });
}

/** Writes a `custom` step's `config.scoring`; like `scoring`, an empty list removes the key. */
export function setConfigScoringRules(
  doc: AuthoredDocument,
  name: string,
  rules: RawWorkflowScoringRule[],
): AuthoredDocument {
  return mapSteps(doc, (step) => {
    if (step.name !== name) return step;
    if (rules.length > 0) return { ...step, config: { ...step.config, scoring: rules } };
    const config = Object.fromEntries(
      Object.entries(step.config ?? {}).filter(([key]) => key !== 'scoring'),
    );
    return { ...step, config };
  });
}

/** A `custom` step with its `config.transitions` replaced; the list is required, so an empty one stays. */
export function setTransitions(
  doc: AuthoredDocument,
  name: string,
  transitions: RawWorkflowTransition[],
): AuthoredDocument {
  return mapSteps(doc, (step) =>
    step.name === name ? { ...step, config: { ...step.config, transitions } } : step,
  );
}

export function snapToGrid(position: CanvasPosition): CanvasPosition {
  return {
    x: Math.round(position.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(position.y / GRID_SIZE) * GRID_SIZE,
  };
}

/** Writes the snapped position of every step `positions` names under its `meta.position`. */
export function setPositions(
  doc: AuthoredDocument,
  positions: ReadonlyMap<string, CanvasPosition>,
): AuthoredDocument {
  return mapSteps(doc, (step) => {
    const position = positions.get(step.name);
    if (position === undefined) return step;
    return { ...step, meta: { ...step.meta, position: snapToGrid(position) } };
  });
}

export function hasPositions(doc: AuthoredDocument): boolean {
  return doc.steps.some((step) => step.meta !== undefined && 'position' in step.meta);
}

/** Once any step has a position, every step gets one, so undo never mixes stored and laid-out spots. */
export function pinPositions(
  doc: AuthoredDocument,
  shown: ReadonlyMap<string, CanvasPosition>,
): AuthoredDocument {
  if (!hasPositions(doc)) return doc;
  const missing = new Map(
    [...shown].filter(([name]) =>
      doc.steps.some(
        (step) => step.name === name && (step.meta === undefined || !('position' in step.meta)),
      ),
    ),
  );
  return missing.size === 0 ? doc : setPositions(doc, missing);
}

/** Starter configs, so a new step of each type lists its ports at once; taken from shipped workflows and specs. */
const STARTER_CONFIGS: Partial<Record<StepTypeName, StepConfig>> = {
  [STEP_TYPE.form]: { fields: {} },
  [STEP_TYPE.contactDetails]: { email: 'required' },
  [STEP_TYPE.consents]: { consents: [{ key: 'terms', acknowledgement: 'accepted' }] },
  [STEP_TYPE.identityProfile]: { nationalities: EEA_PRESET },
  [STEP_TYPE.address]: { countries: EEA_PRESET },
  [STEP_TYPE.questionnaire]: { sections: [QUESTIONNAIRE_SECTIONS[0].key] },
  [STEP_TYPE.documentChoice]: {
    documents: [
      { type: 'PASSPORT', countries: EEA_PRESET },
      { type: 'ID_CARD', countries: EEA_ID_CARD_ISSUERS_PRESET },
    ],
  },
  [STEP_TYPE.documentCapture]: { document: 'PASSPORT' },
  [STEP_TYPE.otpVerify]: {
    channel: OTP_CHANNEL.sms,
    connector: {
      id: 'twilio_sms_otp',
      startConfig: { operation: 'startVerification' },
      checkConfig: { operation: 'checkVerification' },
    },
  },
  [STEP_TYPE.kycIdentityVerification]: {
    connector: { id: 'sumsub_kyc' },
    maxAttemptsPerDocSet: 3,
  },
  [STEP_TYPE.decision]: {
    branches: [{ port: 'yes', when: { field: 'changeMe', isSet: true } }],
    fallback: true,
  },
  [STEP_TYPE.riskScore]: {
    rules: [{ score: 'risk', add: 10 }],
    bands: [{ port: 'high', score: 'risk', gte: 50 }],
    fallback: true,
  },
  [STEP_TYPE.httpCall]: {
    request: { method: HTTP_REQUEST_METHOD.post, url: 'https://example.internal/' },
  },
  [STEP_TYPE.notify]: { connector: { id: 'sendgrid_email' }, recipientField: 'email' },
  [STEP_TYPE.connectorCall]: {
    connectors: [
      { name: 'call', id: 'http_request', type: CUSTOM_CONNECTOR_TYPE, order: 1, fieldMapping: {} },
    ],
  },
  [STEP_TYPE.waitForExternal]: { fields: {} },
  [STEP_TYPE.custom]: { status: WORKFLOW_STATUS.awaitingUser, data: {}, transitions: [] },
  [STEP_TYPE.terminal]: { outcome: WORKFLOW_STATUS.approved },
};

/** A type's starter config; field names are unique across the workflow, so a starter field is named after `owner`. */
function buildStarterConfig(type: string, owner: string): StepConfig | undefined {
  const starter = STARTER_CONFIGS[type as StepTypeName];
  if (starter === undefined) return undefined;
  const config = structuredClone(starter);
  const fields = config.fields;
  if (typeof fields === 'object' && fields !== null && Object.keys(fields).length === 0) {
    config.fields = { [`${owner}_value`]: { type: FIELD_TYPE.text, required: true } };
  }
  return config;
}

export function addStep(
  doc: AuthoredDocument,
  type: string,
  position: CanvasPosition,
): { doc: AuthoredDocument; name: string } {
  const base = type.replaceAll('-', '_');
  const taken = new Set(doc.steps.map((step) => step.name));
  let counter = 1;
  while (taken.has(`${base}_${counter}`)) counter += 1;
  const name = `${base}_${counter}`;
  const config = buildStarterConfig(type, name);
  // The engine lets one workflow id own a source key, so a new KYC step takes it from the id.
  if (type === STEP_TYPE.kycIdentityVerification && config && typeof doc.id === 'string') {
    config.sourceKey = buildSourceKey(doc.id);
  }
  const step: AuthoredStep = {
    name,
    type,
    ...(config ? { config } : {}),
    meta: { position: snapToGrid(position) },
  };
  return { doc: { ...doc, steps: [...doc.steps, step] }, name };
}

/** Appends an included section of `type` to the step, with the type's starter config; a type the step already has is refused. */
export function addInclude(doc: AuthoredDocument, name: string, type: string): AuthoredDocument {
  return mapSteps(doc, (step) => {
    if (step.name !== name || !listIncludableTypes(step).includes(type)) return step;
    const config = buildStarterConfig(type, `${name}_${type.replaceAll('-', '_')}`);
    return { ...step, include: [...(step.include ?? []), { type, ...(config ? { config } : {}) }] };
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
  config: StepConfig,
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
