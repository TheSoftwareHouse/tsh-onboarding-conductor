import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_WAIT_SECONDS = 25;

export class GetSessionQuery {
  /** Seconds the request may wait while the session is processing. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_WAIT_SECONDS)
  wait?: number;
}
