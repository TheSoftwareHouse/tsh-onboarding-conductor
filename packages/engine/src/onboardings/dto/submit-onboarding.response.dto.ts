import { ApiProperty } from '@nestjs/swagger';
import { type ConnectorRejectionReason, type WorkflowStatus } from '@tsh/ddl-schema';
import { WORKFLOW_STATUS_ENUM, CONNECTOR_REJECTION_REASON_ENUM } from '../../openapi/api-enums';

/** Where a submit left the onboarding. */
export class SubmitOnboardingResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The step whose transition the submit applied, normally the one that was current when ' +
      'the data arrived; null when no transition was applied.',
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

  @ApiProperty({
    ...CONNECTOR_REJECTION_REASON_ENUM,
    nullable: true,
    description:
      'Why a connector refused, when the move was a rejection a connector drove; null otherwise.',
  })
  rejectionReason!: ConnectorRejectionReason | null;
}
