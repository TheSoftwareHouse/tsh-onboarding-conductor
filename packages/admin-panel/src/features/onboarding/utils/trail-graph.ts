import type { WorkflowStepDefinition } from '../types/workflow-definition';
import type { OnboardingTransition } from './onboarding-transitions';
import { layoutWorkflowGraph, type WorkflowGraph } from './workflow-graph-layout';
import type { WorkflowPath } from './workflow-path';

/**
 * The state a recorded move entered. The engine resolves the step it belongs to where it can;
 * where it could not - which is precisely the case this graph exists for - the recorded label is
 * the only name that state has, and dropping the node would hide a move that was definitely made.
 */
function nameOf(transition: OnboardingTransition): string {
  return transition.enteredStep ?? transition.label;
}

/** Records a move between two states once, however many times the onboarding made it. */
function addMove(step: WorkflowStepDefinition, target: string, status: string): void {
  const recorded = step.transitions.some(
    (transition) => transition.target === target && transition.status === status,
  );

  if (!recorded) {
    step.transitions.push({ status, target });
  }
}

/**
 * Draws an onboarding whose workflow definition cannot be read, from the only account left: the
 * states it is recorded as having entered, chained in the order they were entered.
 *
 * The result goes through the same layout as a declared workflow, so an operator reads one kind of
 * drawing whether the definition is available or not. What it cannot show is the part of the
 * workflow this onboarding never touched - there are no `pending` nodes here, because a state
 * nothing recorded is a state this has no way of knowing about.
 *
 * The path is accumulated here rather than by `buildWorkflowPath`, which keys on `enteredStep` and
 * so would leave every move the engine could not resolve reading as never taken.
 */
export function buildTrailGraph(transitions: readonly OnboardingTransition[]): WorkflowGraph {
  const steps = new Map<string, WorkflowStepDefinition>();
  const enteredAt = new Map<string, string>();
  let previous: string | null = null;

  for (const transition of transitions) {
    const name = nameOf(transition);
    const entered = steps.get(name);

    if (entered === undefined) {
      steps.set(name, { name, status: transition.status, terminal: false, transitions: [] });
      // First entry wins, as in `buildWorkflowPath`: a state reached again after a loop still
      // reports when it was first reached.
      enteredAt.set(name, transition.occurredAt);
    } else {
      // Last entry wins for the status, so a state the onboarding looped back onto reads as it
      // stands now rather than as it stood the first time through.
      entered.status = transition.status;
    }

    if (previous !== null) {
      // A manual decision names the move better than the status it produced, so it is preferred:
      // a move onto the state it left shows this label rather than an arrow to itself.
      addMove(steps.get(previous)!, name, transition.trigger ?? transition.status);
    }

    previous = name;
  }

  for (const step of steps.values()) {
    step.terminal = step.transitions.length === 0;
  }

  const path: WorkflowPath = { enteredAt, currentStep: previous };

  return layoutWorkflowGraph([...steps.values()], path);
}
