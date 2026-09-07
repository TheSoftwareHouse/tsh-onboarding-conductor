import { isInteger } from '../../value-guards';
import type { FileValidation } from '../../workflow-contract';
import type { FailWorkflow } from '../node-type.port';

/** A scan or photo of a document: the three formats a phone camera and a desktop scanner produce. */
export const DEFAULT_DOCUMENT_CONTENT_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];

/** A selfie is a photograph. A PDF here is a scan of a photograph, which defeats the check. */
export const DEFAULT_SELFIE_CONTENT_TYPES = ['image/png', 'image/jpeg'];

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const CONTENT_TYPE_PATTERN = /^[a-z]+\/[a-z0-9.+-]+$/;

export const uploadValidationSchema = () => ({
  contentTypes: {
    type: 'array',
    minItems: 1,
    uniqueItems: true,
    items: { type: 'string', pattern: CONTENT_TYPE_PATTERN.source },
  },
  maxSizeBytes: { type: 'integer', minimum: 1 },
});

/** Resolves an upload's declared constraints over the defaults for the kind of file it is. */
export const resolveUploadValidation = (
  contentTypes: unknown,
  maxSizeBytes: unknown,
  defaultContentTypes: readonly string[],
  fail: FailWorkflow,
): FileValidation => {
  if (contentTypes !== undefined) {
    if (!Array.isArray(contentTypes) || contentTypes.length === 0) {
      fail('INVALID_VALUE');
    }

    for (const contentType of contentTypes as readonly unknown[]) {
      if (typeof contentType !== 'string' || !CONTENT_TYPE_PATTERN.test(contentType)) {
        fail('INVALID_VALUE');
      }
    }
  }

  if (maxSizeBytes !== undefined && (!isInteger(maxSizeBytes) || (maxSizeBytes as number) <= 0)) {
    fail('INVALID_VALUE');
  }

  return {
    contentTypes: [...((contentTypes as readonly string[] | undefined) ?? defaultContentTypes)],
    maxSizeBytes: (maxSizeBytes as number | undefined) ?? DEFAULT_MAX_UPLOAD_BYTES,
  };
};
