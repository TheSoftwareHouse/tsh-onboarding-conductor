import { NotFoundException } from '@nestjs/common';

export class DocumentUploadNotFoundException extends NotFoundException {
  static readonly apiDescription =
    'No onboarding has this id, or no reservation with this document id belongs to it.';

  constructor() {
    super({
      code: 'DOCUMENT_UPLOAD_NOT_FOUND',
      message: 'DOCUMENT_UPLOAD_NOT_FOUND',
    });
  }
}
