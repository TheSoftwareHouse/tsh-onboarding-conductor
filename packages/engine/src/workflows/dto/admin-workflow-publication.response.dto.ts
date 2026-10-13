import { ApiProperty } from '@nestjs/swagger';
import { WORKFLOW_VERSION_STATUS_ENUM } from '../../openapi/api-enums';
import type { WorkflowStatus } from '../workflow-status';
import { AdminWorkflowRevisionResponseDto } from './admin-workflow-revision.response.dto';

/** A draft revision after publishing, without its document. */
export class AdminWorkflowPublicationResponseDto extends AdminWorkflowRevisionResponseDto {
  @ApiProperty({ ...WORKFLOW_VERSION_STATUS_ENUM, example: 'published' })
  status!: WorkflowStatus;
}
