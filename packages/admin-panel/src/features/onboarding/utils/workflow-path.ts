import type { OnboardingTransition } from './onboarding-transitions';

/** What an onboarding's recorded moves say about the workflow it was run against. */
export interface WorkflowPath {
  /** Every step entered, against the instant it was entered. */
  enteredAt: ReadonlyMap<string, string>;
  /**
   * Every transition actually taken, as `walkedEdgeKey(from, to)`.
   *
   * Kept separately from `enteredAt` because reaching both ends of a transition does not mean
   * taking it: `sumsub-kyc` leaves `submit_kyc` for `approved` directly on a `verified` outcome
   * and for `manual_review` otherwise, so an onboarding that completed both steps the long way
   * round still never used the short edge between them.
   */
  walkedEdges: ReadonlySet<string>;
  /**
   * Steps a move bypassed because their `skip` condition held, against the step that move actually
   * entered.
   *
   * A skipped step was travelled *past*, not merely never reached, so the graph has to say
   * something different about it than about a branch never taken — and the arrows through it are
   * part of the route, which is why they take the colour of the step at the far end rather than of
   * the step they point at.
   */
  skippedSteps: ReadonlyMap<string, string>;
  /** Step it stands on now, or null when nothing has been recorded. */
  currentStep: string | null;
}

/** Keys one direction of travel between two steps. */
export function walkedEdgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/**
 * Walks the recorded transitions over the declared workflow, reporting which steps were entered
 * and where the onboarding stands now.
 *
 * The engine names the step each move entered, including the terminal one a record cannot name on
 * its own, so this only has to accumulate them.
 */
export function buildWorkflowPath(transitions: readonly OnboardingTransition[]): WorkflowPath {
  const enteredAt = new Map<string, string>();
  const walkedEdges = new Set<string>();
  const skippedSteps = new Map<string, string>();
  let currentStep: string | null = null;

  for (const transition of transitions) {
    if (transition.enteredStep === null) {
      continue;
    }

    // First entry wins, so a step reached again after a loop still reports when it was reached.
    if (!enteredAt.has(transition.enteredStep)) {
      enteredAt.set(transition.enteredStep, transition.occurredAt);
    }

    // A move onto the step it started from is a step re-entering itself — an async connector
    // parking and being resumed, say — and travels no edge the graph draws.
    if (transition.fromStep !== null && transition.fromStep !== transition.enteredStep) {
      // A move that bypassed steps travelled the declared edges *through* them, not a direct edge
      // to where it landed — the graph draws no such edge — so the whole chain is walked.
      const route = [transition.fromStep, ...transition.skippedSteps, transition.enteredStep];

      for (let index = 0; index < route.length - 1; index += 1) {
        walkedEdges.add(walkedEdgeKey(route[index], route[index + 1]));
      }

      for (const skipped of transition.skippedSteps) {
        skippedSteps.set(skipped, transition.enteredStep);
      }
    }

    currentStep = transition.enteredStep;
  }

  return { enteredAt, walkedEdges, skippedSteps, currentStep };
}
