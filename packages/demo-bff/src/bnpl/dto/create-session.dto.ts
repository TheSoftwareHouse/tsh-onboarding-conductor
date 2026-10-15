import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateSessionDto {
  /** A persona id, which is also a file name: kept to a safe alphabet. */
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]+$/)
  persona: string;
}
