import { ApiProperty } from '@nestjs/swagger';
import { AdminWorkflowRevisionResponseDto } from './admin-workflow-revision.response.dto';

/** A revision of any status together with its stored document, exactly as it was saved. */
export class AdminWorkflowVersionDocumentResponseDto extends AdminWorkflowRevisionResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'The authored document as stored, verbatim, including connector `config`. A draft may not compile: it is saved unchecked.',
  })
  document!: Record<string, unknown>;
}
