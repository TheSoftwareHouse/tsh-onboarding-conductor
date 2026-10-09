import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Max, Min } from 'class-validator';

/** The `workflow_versions.version` column is a Postgres `integer`; a larger value cannot name a revision. */
export const MAX_WORKFLOW_VERSION = 2_147_483_647;

/** The path of one stored revision: the family key and a positive integer version. */
export class WorkflowVersionParamsDto {
  @ApiProperty({ description: 'The workflow id.', example: 'eu-b2c-individual-kyc-eea' })
  @IsString()
  workflowId!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: MAX_WORKFLOW_VERSION,
    description: 'The revision number.',
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_WORKFLOW_VERSION)
  version!: number;
}
