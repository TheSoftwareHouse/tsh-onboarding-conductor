import { ConflictException } from '@nestjs/common';

export class DocumentUploadExpiredException extends ConflictException {
  static readonly apiDescription = "The reservation's upload window has passed; reserve again.";

  constructor() {
    super({
      code: 'DOCUMENT_UPLOAD_EXPIRED',
      message: 'DOCUMENT_UPLOAD_EXPIRED',
    });
  }
}
