import { NotFoundException } from '@nestjs/common';

export class DocumentUploadNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'DOCUMENT_UPLOAD_NOT_FOUND',
      message: 'DOCUMENT_UPLOAD_NOT_FOUND',
    });
  }
}
