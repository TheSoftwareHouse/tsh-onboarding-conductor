import { BadRequestException } from '@nestjs/common';

export class InvalidDocumentReferenceException extends BadRequestException {
  constructor() {
    super({
      code: 'INVALID_DOCUMENT_REFERENCE',
      message: 'INVALID_DOCUMENT_REFERENCE',
    });
  }
}
