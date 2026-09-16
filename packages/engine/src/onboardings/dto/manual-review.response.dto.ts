import { ApiProperty } from '@nestjs/swagger';
import { type WorkflowStatus } from '@tsh/ddl-schema';
import { WORKFLOW_STATUS_ENUM } from '../../openapi/api-enums';

/** Where a manual review decision left the onboarding. */
export class ManualReviewResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The step whose manual transition was applied; null when none was.',
  })
  appliedStep!: string | null;

  @ApiProperty({ ...WORKFLOW_STATUS_ENUM })
  status!: WorkflowStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The step now awaiting data; null once the onboarding is terminal.',
  })
  currentStep!: string | null;
}
