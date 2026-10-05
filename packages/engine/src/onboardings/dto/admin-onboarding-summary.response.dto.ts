import { ApiProperty } from '@nestjs/swagger';
import { type ConnectorRejectionReason, type WorkflowStatus } from '@tsh/ddl-schema';
import { type OnboardingAgreementStatus } from '../../agreements/agreement.types';
import {
  WORKFLOW_STATUS_ENUM,
  CONNECTOR_REJECTION_REASON_ENUM,
  ONBOARDING_AGREEMENT_STATUS_ENUM,
} from '../../openapi/api-enums';

/** The connector an onboarding is parked on while it awaits a provider's callback. */
export class AdminOnboardingPendingConnectorResponseDto {
  @ApiProperty({ description: 'The id of the connector the onboarding is waiting on.' })
  connectorId!: string;

  @ApiProperty({ description: 'The name the workflow step gives that connector declaration.' })
  connectorName!: string;

  @ApiProperty({
    type: 'integer',
    description: 'The order of the connector slot on the step the connector was parked in.',
  })
  connectorOrder!: number;
}

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

  @ApiProperty({
    ...ONBOARDING_AGREEMENT_STATUS_ENUM,
    description:
      'Aggregated over every agreement family the onboarding holds, as the ' +
      '`onboarding_agreement_statuses` view derives it; `not_accepted` when it holds none.',
  })
  agreementStatus!: OnboardingAgreementStatus;

  @ApiProperty({
    type: () => AdminOnboardingPendingConnectorResponseDto,
    nullable: true,
    description:
      'The connector the onboarding is parked on awaiting a callback; null when it is not ' +
      'waiting for one, and for onboardings parked before this was recorded.',
  })
  pendingConnector!: AdminOnboardingPendingConnectorResponseDto | null;
}
