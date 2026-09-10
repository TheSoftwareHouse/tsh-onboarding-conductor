import { ApiProperty } from '@nestjs/swagger';

/** Where and how the client uploads the file: an S3-style presigned POST. */
export class DocumentUploadTargetResponseDto {
  @ApiProperty({
    enum: ['post-form'],
    description:
      'The upload mechanism. `post-form` is a multipart form POST to `url` that carries every ' +
      'entry of `fields` before the file part, as a presigned POST requires.',
  })
  kind!: 'post-form';

  @ApiProperty({ format: 'uri', description: 'The object store endpoint to POST the form to.' })
  url!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Form fields to send verbatim, before the file part.',
  })
  fields!: Record<string, string>;
}

/** A reservation: the engine has named the object and signed the upload; the client sends the bytes. */
export class ReserveDocumentUploadResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Identifies the reservation; completion names it in the path.',
  })
  documentId!: string;

  @ApiProperty({ type: () => DocumentUploadTargetResponseDto })
  upload!: DocumentUploadTargetResponseDto;

  @ApiProperty({
    format: 'date-time',
    description: 'When the presigned target stops accepting the upload. Complete before then.',
  })
  expiresAt!: string;
}

/** The document is verified against the field's limits and attached to the onboarding. */
export class CompleteDocumentUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  documentId!: string;
}
