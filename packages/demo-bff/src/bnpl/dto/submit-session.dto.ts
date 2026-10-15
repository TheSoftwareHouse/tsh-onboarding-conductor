import { IsObject } from 'class-validator';

export class SubmitSessionDto {
  /** The current step's field values, forwarded to the engine as the submit body. */
  @IsObject()
  values: Record<string, unknown>;
}
