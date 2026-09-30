import { ApiProperty } from '@nestjs/swagger';
import { WORKFLOW_VERSION_STATUS_ENUM } from '../../openapi/api-enums';
import type { WorkflowStatus } from '../workflow-status';

/** One stored revision of a workflow, as the version picker lists it. */
export class AdminWorkflowVersionResponseDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: 'The revision number.' })
  version!: number;

  @ApiProperty({ ...WORKFLOW_VERSION_STATUS_ENUM })
  status!: WorkflowStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
