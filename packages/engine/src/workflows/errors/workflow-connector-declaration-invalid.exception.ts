import { BadRequestException } from '@nestjs/common';

/** The HTTP face of `WorkflowConnectorDeclarationInvalidError`: which step, and what the adapter said. */
export class WorkflowConnectorDeclarationInvalidException extends BadRequestException {
  static readonly apiDescription =
    "A step's connector declaration is refused by the adapter it names; carries " +
    "`stepName` and the adapter's `detail`.";

  constructor(stepName: string, detail: string) {
    super({
      code: 'WORKFLOW_CONNECTOR_DECLARATION_INVALID',
      message: 'WORKFLOW_CONNECTOR_DECLARATION_INVALID',
      stepName,
      detail,
    });
  }
}
