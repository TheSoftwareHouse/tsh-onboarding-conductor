import { BadRequestException } from '@nestjs/common';

export class InvalidDocumentUploadException extends BadRequestException {
  static readonly apiDescription =
    'The reservation or completion is not acceptable: the current step has no such upload ' +
    'field, the content type, size or image dimensions fall outside what the field ' +
    'allows, or the completion body is not empty.';

  constructor() {
    super({
      code: 'INVALID_DOCUMENT_UPLOAD',
      message: 'INVALID_DOCUMENT_UPLOAD',
    });
  }
}
