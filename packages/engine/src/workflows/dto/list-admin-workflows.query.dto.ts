import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { WORKFLOW_SCOPE_ENUM } from '../../openapi/api-enums';
import { PaginationQueryDto } from '../../pagination';
import { WORKFLOW_SCOPES, type WorkflowScope } from '../workflow-scope';

// Converts the query literals "true"/"false" to booleans; anything else is left for `@IsBoolean` to reject.
const toStrictBooleanQueryValue = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return value;
};

/** Filter criteria the admin workflows list accepts, on top of the inherited `page`/`limit` window. */
export class ListAdminWorkflowsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Case-insensitive substring match against the workflow id or name.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ ...WORKFLOW_SCOPE_ENUM, description: 'Only workflows in this scope.' })
  @IsOptional()
  @IsString()
  @IsIn(WORKFLOW_SCOPES)
  scope?: WorkflowScope;

  @ApiPropertyOptional({
    type: 'boolean',
    description: 'When `true`, only workflows holding at least one draft version.',
  })
  @IsOptional()
  @Transform(toStrictBooleanQueryValue)
  @IsBoolean()
  hasDraft?: boolean;
}
