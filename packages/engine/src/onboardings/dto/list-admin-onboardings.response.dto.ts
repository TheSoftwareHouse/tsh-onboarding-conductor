import { ApiProperty } from '@nestjs/swagger';
import { PaginatedMetaResponseDto } from '../../pagination';
import { AdminOnboardingSummaryResponseDto } from './admin-onboarding-summary.response.dto';

/**
 * One page of admin onboarding summaries. Mirrors the audit list envelope so the admin panel
 * reads every paginated endpoint the same way.
 */
export class ListAdminOnboardingsResponseDto {
  @ApiProperty({ type: () => AdminOnboardingSummaryResponseDto, isArray: true })
  items!: AdminOnboardingSummaryResponseDto[];

  @ApiProperty({ type: () => PaginatedMetaResponseDto })
  meta!: PaginatedMetaResponseDto;
}
