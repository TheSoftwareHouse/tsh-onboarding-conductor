import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CreateSessionDto {
  /** Optional: a session may start without a persona and take one at the bank login. A persona id, which is also a file name: kept to a safe alphabet. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]+$/)
  persona?: string;
}
