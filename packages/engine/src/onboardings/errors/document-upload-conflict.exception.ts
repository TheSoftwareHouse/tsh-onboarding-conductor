import { ConflictException } from '@nestjs/common';

export class DocumentUploadConflictException extends ConflictException {
  constructor() {
    super({
      code: 'DOCUMENT_UPLOAD_CONFLICT',
      message: 'DOCUMENT_UPLOAD_CONFLICT',
    });
  }
}
