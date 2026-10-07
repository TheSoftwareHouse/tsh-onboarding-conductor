import { ApiProperty } from '@nestjs/swagger';
import { AdminWorkflowDraftResponseDto } from './admin-workflow-draft.response.dto';

/** A draft together with its stored document, exactly as it was saved. */
export class AdminWorkflowDraftDocumentResponseDto extends AdminWorkflowDraftResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'The authored document as stored, verbatim. It may not compile: a draft is saved unchecked.',
  })
  document!: Record<string, unknown>;
}
