/** One state the onboarding entered, as the audit trail recorded it. */
export class OnboardingTransitionResponseDto {
  /** Audit row id, which is also a stable key for a reader drawing the chain. */
  id!: string;
  occurredAt!: Date;
  /** Status the move put the onboarding in. */
  status!: string;
  /** Step it was on beforehand; null for the move that started it. */
  fromStep!: string | null;
  /** Step whose transition was applied, which for a terminal move names the step left behind. */
  appliedStep!: string | null;
  /**
   * Step actually entered, resolved against the workflow revision the onboarding runs on. Null
   * when the revision can no longer be read, or declares nothing that could have produced the
   * recorded status.
   */
  enteredStep!: string | null;
  /** Manual review trigger, such as `manual.approve`, when an operator decision drove the move. */
  trigger!: string | null;
  /** True for the last recorded move, which is where the onboarding stands now. */
  current!: boolean;
}

/**
 * The chain of states one onboarding moved through, oldest first.
 *
 * Not paginated: a reader wants the journey, not a window onto it. `truncated` is the one thing a
 * page window would have said that still matters — an onboarding that looped more times than the
 * endpoint reads is reported from the middle, and saying so is better than presenting a partial
 * chain as the whole story.
 */
export class ListOnboardingTransitionsResponseDto {
  items!: OnboardingTransitionResponseDto[];
  meta!: { truncated: boolean };
}
