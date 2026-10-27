import type {
  CompiledWorkflowStep,
  RawWorkflowStep,
  RawWorkflowStepInclude,
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
  PublishedDocument,
  PublishedDocumentOption,
  PublishedQuestionnaireItem,
  ResolvedStepInclude,
  StepFieldMap,
  WorkflowStepContract,
  WorkflowStepPort,
  WorkflowStepTypeDefinition,
} from './step-type.port';

// Names come from untrusted workflow JSON. `in` and a bare index read walk the prototype, so a step
// or field called `constructor` would collide with `Object.prototype` rather than with another
// step — the same reason the registries are Maps.
export const hasOwn = (target: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

/**
 * What a step type writes as a transition's `target` to follow a port. The compiler substitutes the
 * real destination afterwards. The marker is NUL, which cannot appear in a step name (the schema
 * restricts those to `[A-Za-z0-9_-]`), so a token can never be mistaken for a step.
 */
export const TOKEN_MARK = String.fromCharCode(0);

const buildPortToken = (stepName: string, port: string): string =>
  `${TOKEN_MARK}${stepName}${TOKEN_MARK}${port}${TOKEN_MARK}`;

export const isPortToken = (target: string | undefined): target is string =>
  target !== undefined && target.startsWith(TOKEN_MARK);

/** One authored step, resolved: its type, its parsed config, its fragments and the steps it owns. */
export type ResolvedStep = {
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
};

/** One step's compile: the compiled steps it produced, or the failure that was its own. */
export type StepCompileOutcome =
  | { readonly kind: 'compiled'; readonly steps: CompiledWorkflowStep[] }
  | { readonly kind: 'failed'; readonly error: unknown };

/** One step's resolution: the resolved step, or the failure that was its own. */
export type StepResolveOutcome =
  | { readonly kind: 'resolved'; readonly resolved: ResolvedStep }
  | { readonly kind: 'failed'; readonly error: unknown };

const resolveInclude = (include: RawWorkflowStepInclude): ResolvedStepInclude => {
  const definition = getStepType(include.type);

  // A fragment contributes fields to someone else's step; a type with control flow of its own would
  // lose it silently in the merge.
  if (definition.composable !== true) {
    failWorkflow('INVALID_VALUE');
  }

  return { definition, include, config: definition.parseConfig(include.config, failWorkflow) };
};

/** Parses the step's type, config and includes, and builds its fields, sub-step names and ports. */
export const resolveStep = (step: RawWorkflowStep, index: number): ResolvedStep => {
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
  };
};

/** `resolveStep`, with its failure returned rather than thrown, so one bad step stops no other. */
export const tryResolveStep = (step: RawWorkflowStep, index: number): StepResolveOutcome => {
  try {
    return { kind: 'resolved', resolved: resolveStep(step, index) };
  } catch (error) {
    return { kind: 'failed', error };
  }
};

/**
 * What the given steps published, in their order. Scoped per consumer to the steps that can precede
 * it, which is what lets a step read what its neighbours collect — a `kyc` step compiled in
 * isolation would have to be told its own field mapping — without a step placed *after* it leaking
 * a field into that mapping that will never have been collected when the mapping is read.
 */
export const assembleContract = (contributors: readonly ResolvedStep[]): WorkflowStepContract => {
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
 * Compiles one resolved step against what `contributors` publish — itself and the steps that run
 * before it. A port in `wiredPorts` gets a token as its target, which the caller replaces with the
 * real destination; any other port reads as `undefined`.
 */
export const compileStep = (
  entry: ResolvedStep,
  contributors: readonly ResolvedStep[],
  wiredPorts: ReadonlySet<string>,
): CompiledWorkflowStep[] => {
  // Prototype-less: a type reads `targets[port]` by bare index, and the schema has already
  // refused the names `Object.prototype` answers to, but a map handed to code outside this
  // module should not depend on that — an undeclared port must read as `undefined`, never as
  // an inherited function, and `__proto__` must be an ordinary key, not a setter.
  const targets: Record<string, string | undefined> = Object.create(null);

  for (const port of entry.ports) {
    targets[port.name] = wiredPorts.has(port.name)
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

  return compiled;
};

/** `compileStep`, with its failure returned rather than thrown, so one bad step stops no other. */
export const tryCompileStep = (
  entry: ResolvedStep,
  contributors: readonly ResolvedStep[],
  wiredPorts: ReadonlySet<string>,
): StepCompileOutcome => {
  try {
    return { kind: 'compiled', steps: compileStep(entry, contributors, wiredPorts) };
  } catch (error) {
    return { kind: 'failed', error };
  }
};
