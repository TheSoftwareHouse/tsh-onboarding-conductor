import type { CompiledWorkflow } from './workflow-version-reader';

type Step = CompiledWorkflow['steps'][number];
type Transition = Step['transitions'][number];
type ScoringRule = NonNullable<Step['scoring']>[number];
type Connector = NonNullable<Step['connectors']>[number];
type Agreement = NonNullable<CompiledWorkflow['agreements']>[number];

interface Named<T> {
  name: string;
  value: T;
}

/** An item present on both sides whose content differs. */
export interface ChangedItem<T> {
  before: T;
  after: T;
}

export interface ItemDiff<T> {
  added: T[];
  removed: T[];
  changed: Array<ChangedItem<T>>;
}

/** The properties of a named item that differ, each with its value on both sides. */
export interface NamedChange {
  name: string;
  changes: Record<string, ChangedItem<unknown>>;
}

export interface NamedDiff {
  added: string[];
  removed: string[];
  changed: NamedChange[];
}

export interface StepChange {
  name: string;
  status?: ChangedItem<Step['status']>;
  fields?: NamedDiff;
  transitions?: ItemDiff<Transition>;
  scoringRules?: ItemDiff<ScoringRule>;
  connectors?: NamedDiff;
}

export interface WorkflowDiff {
  identical: boolean;
  workflow?: Record<string, ChangedItem<unknown>>;
  scores?: NamedDiff;
  agreements?: NamedDiff;
  steps?: { added: string[]; removed: string[]; changed: StepChange[] };
}

/** JSON with every object's keys sorted, so two equal values always serialise alike. */
function canonicalise(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    nested !== null && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.fromEntries(
          Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)),
        )
      : nested,
  );
}

function isEqual(left: unknown, right: unknown): boolean {
  return canonicalise(left) === canonicalise(right);
}

/**
 * Items of a list that has no identity of its own: those identical on both sides cancel out, the
 * rest pair up by `keyOf` (a threshold edited in place is one change) and what is left over was
 * added or removed.
 */
function diffItems<T>(
  before: readonly T[],
  after: readonly T[],
  keyOf: (item: T) => string,
): ItemDiff<T> {
  const unmatchedBefore = [...before];
  const unmatchedAfter: T[] = [];

  for (const item of after) {
    const twin = unmatchedBefore.findIndex((candidate) => isEqual(candidate, item));
    if (twin < 0) {
      unmatchedAfter.push(item);
    } else {
      unmatchedBefore.splice(twin, 1);
    }
  }

  const added: T[] = [];
  const changed: Array<ChangedItem<T>> = [];

  for (const item of unmatchedAfter) {
    const partner = unmatchedBefore.findIndex((candidate) => keyOf(candidate) === keyOf(item));
    if (partner < 0) {
      added.push(item);
    } else {
      changed.push({ before: unmatchedBefore.splice(partner, 1)[0], after: item });
    }
  }

  return { added, removed: unmatchedBefore, changed };
}

function diffProperties(before: object, after: object): Record<string, ChangedItem<unknown>> {
  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  const changes: Record<string, ChangedItem<unknown>> = {};

  for (const property of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!isEqual(left[property], right[property])) {
      changes[property] = { before: left[property], after: right[property] };
    }
  }

  return changes;
}

function diffNamed<T extends object>(
  before: ReadonlyArray<Named<T>>,
  after: ReadonlyArray<Named<T>>,
): NamedDiff {
  const beforeByName = new Map(before.map((item) => [item.name, item.value]));
  const afterByName = new Map(after.map((item) => [item.name, item.value]));
  const changed: NamedChange[] = [];

  for (const [name, value] of afterByName) {
    const previous = beforeByName.get(name);
    const changes = previous === undefined ? {} : diffProperties(previous, value);
    if (Object.keys(changes).length > 0) {
      changed.push({ name, changes });
    }
  }

  return {
    added: [...afterByName.keys()].filter((name) => !beforeByName.has(name)),
    removed: [...beforeByName.keys()].filter((name) => !afterByName.has(name)),
    changed,
  };
}

const isEmptyNamedDiff = (diff: NamedDiff) =>
  diff.added.length + diff.removed.length + diff.changed.length === 0;

const isEmptyItemDiff = (diff: ItemDiff<unknown>) =>
  diff.added.length + diff.removed.length + diff.changed.length === 0;

const transitionKey = (transition: Transition) =>
  canonicalise([transition.status, transition.target, transition.reason]);

const scoringRuleKey = (rule: ScoringRule) => canonicalise([rule.score, rule.when]);

function diffStep(before: Step, after: Step): StepChange | undefined {
  const fields = diffNamed(
    Object.entries(before.data).map(([name, value]) => ({ name, value })),
    Object.entries(after.data).map(([name, value]) => ({ name, value })),
  );
  const connectors = diffNamed(
    (before.connectors ?? []).map((value: Connector) => ({ name: value.name, value })),
    (after.connectors ?? []).map((value: Connector) => ({ name: value.name, value })),
  );
  const transitions = diffItems(before.transitions, after.transitions, transitionKey);
  const scoringRules = diffItems(before.scoring ?? [], after.scoring ?? [], scoringRuleKey);

  const change: StepChange = {
    name: after.name,
    ...(before.status === after.status
      ? {}
      : { status: { before: before.status, after: after.status } }),
    ...(isEmptyNamedDiff(fields) ? {} : { fields }),
    ...(isEmptyItemDiff(transitions) ? {} : { transitions }),
    ...(isEmptyItemDiff(scoringRules) ? {} : { scoringRules }),
    ...(isEmptyNamedDiff(connectors) ? {} : { connectors }),
  };

  return Object.keys(change).length > 1 ? change : undefined;
}

/**
 * What differs between two compiled versions of a workflow: steps, their fields, transitions,
 * score rules and connectors, plus the score bounds, agreements and root properties. Transition
 * conditions carry the thresholds, so a changed threshold shows as a changed transition.
 */
export function diffCompiledWorkflows(
  before: CompiledWorkflow,
  after: CompiledWorkflow,
): WorkflowDiff {
  const workflow = diffProperties(
    { name: before.name, initial: before.initial, webhook: before.webhook },
    { name: after.name, initial: after.initial, webhook: after.webhook },
  );
  const scores = diffNamed(
    Object.entries(before.scoring ?? {}).map(([name, value]) => ({ name, value })),
    Object.entries(after.scoring ?? {}).map(([name, value]) => ({ name, value })),
  );
  const agreements = diffNamed(
    (before.agreements ?? []).map((value: Agreement) => ({ name: value.key, value })),
    (after.agreements ?? []).map((value: Agreement) => ({ name: value.key, value })),
  );
  const steps = diffNamed(
    before.steps.map((value) => ({ name: value.name, value })),
    after.steps.map((value) => ({ name: value.name, value })),
  );
  const beforeSteps = new Map(before.steps.map((step) => [step.name, step]));
  const changedSteps = after.steps.flatMap((step) => {
    const previous = beforeSteps.get(step.name);
    const change = previous === undefined ? undefined : diffStep(previous, step);
    return change === undefined ? [] : [change];
  });
  const stepsChanged = steps.added.length + steps.removed.length + changedSteps.length > 0;

  const diff: WorkflowDiff = {
    identical: false,
    ...(Object.keys(workflow).length === 0 ? {} : { workflow }),
    ...(isEmptyNamedDiff(scores) ? {} : { scores }),
    ...(isEmptyNamedDiff(agreements) ? {} : { agreements }),
    ...(stepsChanged
      ? { steps: { added: steps.added, removed: steps.removed, changed: changedSteps } }
      : {}),
  };

  return { ...diff, identical: Object.keys(diff).length === 1 };
}
