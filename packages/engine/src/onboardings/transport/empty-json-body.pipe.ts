import { Injectable, PipeTransform } from '@nestjs/common';
import { InvalidDocumentUploadException } from '../errors/invalid-document-upload.exception';

@Injectable()
export class EmptyJsonBodyPipe implements PipeTransform<unknown, Record<string, never>> {
  transform(value: unknown): Record<string, never> {
    if (value === undefined) {
      return {};
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new InvalidDocumentUploadException();
    }

    if (Object.keys(value).length > 0) {
      throw new InvalidDocumentUploadException();
    }

    return {};
  }
}
