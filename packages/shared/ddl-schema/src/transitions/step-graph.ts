import type { RawWorkflowStep } from '../workflow-contract';

const areStringSetsEqual = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean => {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
};

/**
 * Iterative dominator analysis over the step graph. A step's guaranteed predecessors are the steps
 * every path from the initial step must pass through, which is what connector field mapping needs
 * to know a value will already exist.
 */
export const buildGuaranteedPredecessorsByStepName = (
  steps: readonly RawWorkflowStep[],
  initialStepName: string,
): Record<string, ReadonlySet<string>> => {
  const allStepNames = steps.map((step) => step.name);
  const allStepNameSet = new Set(allStepNames);
  const predecessorsByStepName = new Map<string, Set<string>>();

  for (const stepName of allStepNames) {
    predecessorsByStepName.set(stepName, new Set());
  }

  for (const step of steps) {
    for (const transition of step.transitions) {
      if (typeof transition.target !== 'string' || !allStepNameSet.has(transition.target)) {
        continue;
      }

      predecessorsByStepName.get(transition.target)?.add(step.name);
    }
  }

  const dominatorsByStepName = new Map<string, Set<string>>();
  for (const stepName of allStepNames) {
    dominatorsByStepName.set(
      stepName,
      stepName === initialStepName ? new Set([stepName]) : new Set(allStepNames),
    );
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const stepName of allStepNames) {
      if (stepName === initialStepName) {
        continue;
      }

      const predecessors = predecessorsByStepName.get(stepName);
      if (!predecessors || predecessors.size === 0) {
        const nextDominators = new Set([stepName]);
        if (!areStringSetsEqual(nextDominators, dominatorsByStepName.get(stepName) ?? new Set())) {
          dominatorsByStepName.set(stepName, nextDominators);
          changed = true;
        }
        continue;
      }

      let intersection: Set<string> | null = null;
      for (const predecessor of predecessors) {
        const predecessorDominators = dominatorsByStepName.get(predecessor);
        if (!predecessorDominators) {
          continue;
        }

        if (intersection === null) {
          intersection = new Set(predecessorDominators);
          continue;
        }

        for (const candidate of Array.from(intersection)) {
          if (!predecessorDominators.has(candidate)) {
            intersection.delete(candidate);
          }
        }
      }

      const nextDominators = new Set<string>([stepName]);
      for (const dominator of intersection ?? []) {
        nextDominators.add(dominator);
      }

      if (!areStringSetsEqual(nextDominators, dominatorsByStepName.get(stepName) ?? new Set())) {
        dominatorsByStepName.set(stepName, nextDominators);
        changed = true;
      }
    }
  }

  const guaranteedPredecessorsByStepName: Record<string, ReadonlySet<string>> = {};
  for (const stepName of allStepNames) {
    const dominators = dominatorsByStepName.get(stepName) ?? new Set<string>([stepName]);
    guaranteedPredecessorsByStepName[stepName] = new Set(
      Array.from(dominators).filter((dominatorStepName) => dominatorStepName !== stepName),
    );
  }

  return guaranteedPredecessorsByStepName;
};
