/** One state the onboarding entered, as the engine reports it from the audit trail. */
export interface OnboardingTransition {
  /** Audit row id, which is also the React key for the node. */
  id: string;
  occurredAt: string;
  /** The state reached: the step entered, or the status once no step remains. */
  label: string;
  status: string;
  /** Step the onboarding was on beforehand; null for the transition that started it. */
  fromStep: string | null;
  /** Step whose transition was applied, which for a terminal move names the step left behind. */
  appliedStep: string | null;
  /**
   * Step entered, already resolved by the engine against the revision the onboarding runs on.
   * Null only when that revision could not be read, or declares nothing matching the move.
   */
  enteredStep: string | null;
  /** Manual review trigger, such as `manual.approve`, when an operator decision drove the move. */
  trigger: string | null;
  /** True for the last recorded state, which is where the onboarding stands now. */
  current: boolean;
  /** The onboarding's total after this move. */
  scoreAfter: number;
  /**
   * How far the total moved. On a step re-entered through a loop this is not that step's own
   * contribution, because the earlier one was replaced rather than added to.
   */
  scoreDelta: number;
  /** Steps this move bypassed because their skip condition held; empty when none was. */
  skippedSteps: readonly string[];
}
