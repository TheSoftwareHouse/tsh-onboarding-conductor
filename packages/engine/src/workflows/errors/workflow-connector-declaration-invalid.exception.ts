import { BadRequestException } from '@nestjs/common';

/** The HTTP face of `WorkflowConnectorDeclarationInvalidError`: which step, and what the adapter said. */
export class WorkflowConnectorDeclarationInvalidException extends BadRequestException {
  constructor(stepName: string, detail: string) {
    super({
      code: 'WORKFLOW_CONNECTOR_DECLARATION_INVALID',
      message: 'WORKFLOW_CONNECTOR_DECLARATION_INVALID',
      stepName,
      detail,
    });
  }
}
