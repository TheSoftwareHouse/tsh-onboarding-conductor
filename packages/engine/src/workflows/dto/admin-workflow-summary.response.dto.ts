import { ApiProperty } from '@nestjs/swagger';
import { WORKFLOW_SCOPE_ENUM } from '../../openapi/api-enums';
import type { WorkflowScope } from '../workflow-scope';

/** One workflow family as the operator list reports it, with its computed counts. */
export class AdminWorkflowSummaryResponseDto {
  @ApiProperty({ description: 'The workflow id — `workflows.key`.' })
  workflowId!: string;

  @ApiProperty({ type: String, nullable: true, description: "The family's display label." })
  name!: string | null;

  @ApiProperty({ ...WORKFLOW_SCOPE_ENUM })
  scope!: WorkflowScope;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    nullable: true,
    description: 'The highest published version, or null when none is served.',
  })
  servingVersion!: number | null;

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Every stored version, any status.' })
  versionCount!: number;

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Stored versions currently in draft.' })
  draftCount!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Onboardings on any version of this workflow that have not completed.',
  })
  inProgressCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
