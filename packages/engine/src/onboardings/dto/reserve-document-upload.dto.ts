import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class ReserveDocumentUploadDto {
  @ApiProperty({
    description: "Name of the current step's upload field the document is for.",
    example: 'identity_document_front',
  })
  @IsString()
  @IsNotEmpty()
  field!: string;

  @ApiProperty({
    description: 'MIME type of the file to upload; must be one the field accepts.',
    example: 'image/jpeg',
  })
  @IsString()
  @IsNotEmpty()
  contentType!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: "Exact size of the file in bytes; must not exceed the field's limit.",
    example: 245760,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  sizeBytes!: number;
}
