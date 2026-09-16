import { ApiProperty } from '@nestjs/swagger';

/** One state the onboarding entered, as the audit trail recorded it. */
export class OnboardingTransitionResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Audit row id, which is also a stable key for a reader drawing the chain.',
  })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;

  @ApiProperty({ description: 'Status the move put the onboarding in.' })
  status!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Step it was on beforehand; null for the move that started it.',
  })
  fromStep!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Step whose transition was applied, which for a terminal move names the step left behind.',
  })
  appliedStep!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Step actually entered, resolved against the workflow revision the onboarding runs on. Null ' +
      'when the revision can no longer be read, or declares nothing that could have produced the ' +
      'recorded status.',
  })
  enteredStep!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Manual review trigger, such as `manual.approve`, when an operator decision drove the move.',
  })
  trigger!: string | null;

  @ApiProperty({
    description: 'True for the last recorded move, which is where the onboarding stands now.',
  })
  current!: boolean;
}

export class OnboardingTransitionsMetaResponseDto {
  @ApiProperty({
    description:
      'True when the onboarding moved more times than the endpoint reads, so the chain is ' +
      'reported from the middle rather than from the start.',
  })
  truncated!: boolean;
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
  @ApiProperty({ type: () => OnboardingTransitionResponseDto, isArray: true })
  items!: OnboardingTransitionResponseDto[];

  @ApiProperty({ type: () => OnboardingTransitionsMetaResponseDto })
  meta!: OnboardingTransitionsMetaResponseDto;
}
