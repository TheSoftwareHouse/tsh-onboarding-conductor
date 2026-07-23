import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class ReserveDocumentUploadDto {
  @IsString()
  @IsNotEmpty()
  field!: string;

  @IsString()
  @IsNotEmpty()
  contentType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  sizeBytes!: number;
}
