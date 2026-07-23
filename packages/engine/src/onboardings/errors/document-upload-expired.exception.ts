import { ConflictException } from '@nestjs/common';

export class DocumentUploadExpiredException extends ConflictException {
  constructor() {
    super({
      code: 'DOCUMENT_UPLOAD_EXPIRED',
      message: 'DOCUMENT_UPLOAD_EXPIRED',
    });
  }
}
