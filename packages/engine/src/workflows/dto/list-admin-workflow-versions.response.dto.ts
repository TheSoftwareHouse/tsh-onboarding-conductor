import { ApiProperty } from '@nestjs/swagger';
import { AdminWorkflowVersionResponseDto } from './admin-workflow-version.response.dto';

/** Every stored version of one workflow, newest first. */
export class ListAdminWorkflowVersionsResponseDto {
  @ApiProperty({ type: () => AdminWorkflowVersionResponseDto, isArray: true })
  items!: AdminWorkflowVersionResponseDto[];
}
