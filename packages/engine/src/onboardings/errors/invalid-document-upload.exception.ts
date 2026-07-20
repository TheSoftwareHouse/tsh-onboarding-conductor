import { BadRequestException } from '@nestjs/common';

export class InvalidDocumentUploadException extends BadRequestException {
  constructor() {
    super({
      code: 'INVALID_DOCUMENT_UPLOAD',
      message: 'INVALID_DOCUMENT_UPLOAD',
    });
  }
}
