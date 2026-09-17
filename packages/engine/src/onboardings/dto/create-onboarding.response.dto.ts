import { ApiProperty } from '@nestjs/swagger';
import { type WorkflowStatus } from '@tsh/ddl-schema';
import { WORKFLOW_STATUS_ENUM } from '../../openapi/api-enums';

/** What starting an onboarding hands back: the id the client keeps, and where the onboarding stands. */
export class CreateOnboardingResponseDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The new onboarding. Treat it as a capability: every flow route is keyed by it and none ' +
      'of them is authenticated.',
  })
  onboardingId!: string;

  @ApiProperty({
    ...WORKFLOW_STATUS_ENUM,
    description: 'Status after the initial step was entered.',
  })
  status!: WorkflowStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The step now awaiting data; null once the onboarding is terminal.',
  })
  currentStep!: string | null;

  @ApiProperty({
    type: 'null',
    description: 'Reserved. Onboardings do not expire yet, so this is always null.',
  })
  expiresAt!: null;
}
