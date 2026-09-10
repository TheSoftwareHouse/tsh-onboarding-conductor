import { ApiProperty } from '@nestjs/swagger';
import { type ConnectorRejectionReason, type WorkflowStatus } from '@tsh/ddl-schema';
import { WORKFLOW_STATUS_ENUM, CONNECTOR_REJECTION_REASON_ENUM } from '../../openapi/api-enums';

/** One onboarding as the operator surface reports it: the record, without its collected data. */
export class AdminOnboardingSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  onboardingId!: string;

  @ApiProperty()
  workflowId!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: 'The workflow revision the onboarding is pinned to.',
  })
  workflowVersion!: number;

  @ApiProperty({ ...WORKFLOW_STATUS_ENUM })
  status!: WorkflowStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The step awaiting data; null once the onboarding is terminal.',
  })
  currentStep!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Reserved. Onboardings do not expire yet, so this is always null.',
  })
  expiresAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the onboarding reached a terminal status; null while it is still running.',
  })
  completedAt!: Date | null;

  @ApiProperty({
    ...CONNECTOR_REJECTION_REASON_ENUM,
    nullable: true,
    description:
      'Why a connector refused, when a rejection a connector drove ended the onboarding.',
  })
  rejectionReason!: ConnectorRejectionReason | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'The current value of every score the workflow declares, keyed by score name.',
  })
  scores!: Record<string, number>;
}
