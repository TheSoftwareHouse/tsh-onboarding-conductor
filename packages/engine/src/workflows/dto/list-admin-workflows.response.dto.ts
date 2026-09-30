import { ApiProperty } from '@nestjs/swagger';
import { PaginatedMetaResponseDto } from '../../pagination';
import { AdminWorkflowSummaryResponseDto } from './admin-workflow-summary.response.dto';

/** One page of admin workflow summaries. */
export class ListAdminWorkflowsResponseDto {
  @ApiProperty({ type: () => AdminWorkflowSummaryResponseDto, isArray: true })
  items!: AdminWorkflowSummaryResponseDto[];

  @ApiProperty({ type: () => PaginatedMetaResponseDto })
  meta!: PaginatedMetaResponseDto;
}
