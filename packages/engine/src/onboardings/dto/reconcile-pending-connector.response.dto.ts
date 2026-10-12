import { ApiProperty } from '@nestjs/swagger';
import {
  PENDING_CONNECTOR_RECONCILE_OUTCOME_ENUM,
  type PendingConnectorReconcileOutcome,
} from '../../openapi/api-enums';
import { AdminOnboardingSummaryResponseDto } from './admin-onboarding-summary.response.dto';

/** What a reconcile did, and the onboarding as it stands afterwards. */
export class ReconcilePendingConnectorResponseDto {
  @ApiProperty({ ...PENDING_CONNECTOR_RECONCILE_OUTCOME_ENUM })
  outcome!: PendingConnectorReconcileOutcome;

  @ApiProperty({
    type: () => AdminOnboardingSummaryResponseDto,
    description: 'The onboarding record after the reconcile, as the admin list reports it.',
  })
  onboarding!: AdminOnboardingSummaryResponseDto;
}
