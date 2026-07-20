import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ListAdminOnboardingsQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['awaiting_user', 'approved'])
  status?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(100)
  workflowId?: string;
}
