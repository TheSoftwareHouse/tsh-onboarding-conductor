import { ApiProperty } from '@nestjs/swagger';
import { WORKFLOW_VERSION_STATUS_ENUM } from '../../openapi/api-enums';
import type { WorkflowStatus } from '../workflow-status';

/** A draft revision after publishing, without its document. */
export class AdminWorkflowPublicationResponseDto {
  @ApiProperty({ description: 'The workflow id the version belongs to.', example: 'my-onboarding' })
  workflowId!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: 'The revision number that was published.',
  })
  version!: number;

  @ApiProperty({ ...WORKFLOW_VERSION_STATUS_ENUM, example: 'published' })
  status!: WorkflowStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "The family's display label, or null when it has none.",
  })
  name!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
