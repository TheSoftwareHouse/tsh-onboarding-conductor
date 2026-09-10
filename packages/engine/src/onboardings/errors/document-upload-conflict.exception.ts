import { ConflictException } from '@nestjs/common';

export class DocumentUploadConflictException extends ConflictException {
  static readonly apiDescription =
    'The onboarding is already terminal, or the field still has an unexpired reservation ' +
    'pending.';

  constructor() {
    super({
      code: 'DOCUMENT_UPLOAD_CONFLICT',
      message: 'DOCUMENT_UPLOAD_CONFLICT',
    });
  }
}
