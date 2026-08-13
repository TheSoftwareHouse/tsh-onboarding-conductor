import { isInteger } from '../value-guards';
import type { FileValidation, NormalizedWorkflowField } from '../workflow-contract';
import type {
  FailWorkflow,
  JsonSchemaFragment,
  WorkflowFieldLevel,
  WorkflowFieldTypeDefinition,
} from './field-type.port';
import { buildFieldDescriptorSchema, buildFieldEnvelope } from './field-value.utils';

export type NormalizedFileField = NormalizedWorkflowField & {
  type: 'file';
  validation: FileValidation;
};

/** Lets consumers ask "is this the upload field?" without spelling the type name themselves. */
export const isNormalizedFileField = (
  field: NormalizedWorkflowField,
): field is NormalizedFileField => field.type === 'file';

const ALLOWED_VALIDATION_KEYS = ['contentTypes', 'maxSizeBytes', 'maxImageWidth', 'maxImageHeight'];

const normalizeContentTypes = (validation: Record<string, unknown>): string[] =>
  ((validation as FileValidation).contentTypes as string[]).map((contentType) =>
    contentType.trim().toLowerCase(),
  );

export const fileFieldTypeDefinition = {
  type: 'file',
  aliases: [],
  levels: ['root'],
  maxOccurrencesPerStep: 1,
  alwaysRequiredInStepData: true,
  // The file validation object is inlined in the descriptor; it has no shared definition.
  buildValidationSchema: () => undefined,
  buildDescriptorSchema(level: WorkflowFieldLevel): JsonSchemaFragment {
    return buildFieldDescriptorSchema(level, {
      typeSchema: { const: 'file' },
      requiredSchema: { type: 'boolean', const: true },
      requiredMembers: ['validation'],
      members: {
        validation: {
          type: 'object',
          additionalProperties: false,
          required: ['contentTypes', 'maxSizeBytes'],
          properties: {
            contentTypes: {
              type: 'array',
              minItems: 1,
              uniqueItems: true,
              items: { type: 'string', minLength: 1 },
            },
            maxSizeBytes: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
            maxImageWidth: { type: 'integer', minimum: 1 },
            maxImageHeight: { type: 'integer', minimum: 1 },
          },
        },
      },
      conditionLevels: ['root'],
    });
  },
  validateValidation(validation: Record<string, unknown>, fail: FailWorkflow): void {
    for (const key of Object.keys(validation)) {
      if (!ALLOWED_VALIDATION_KEYS.includes(key)) {
        fail('INVALID_VALUE');
      }
    }

    if (!('contentTypes' in validation) || !('maxSizeBytes' in validation)) {
      fail('INVALID_VALUE');
    }

    const contentTypes = validation.contentTypes;
    if (!Array.isArray(contentTypes) || contentTypes.length === 0) {
      fail('INVALID_VALUE');
    }

    const normalizedContentTypes: string[] = [];
    for (const contentType of contentTypes as unknown[]) {
      if (typeof contentType !== 'string') {
        fail('INVALID_VALUE');
      }

      const normalizedContentType = (contentType as string).trim().toLowerCase();
      if (normalizedContentType.length === 0) {
        fail('INVALID_VALUE');
      }
      normalizedContentTypes.push(normalizedContentType);
    }

    if (new Set(normalizedContentTypes).size !== normalizedContentTypes.length) {
      fail('INVALID_VALUE');
    }

    const maxSizeBytes = validation.maxSizeBytes;
    if (!isInteger(maxSizeBytes) || maxSizeBytes < 1 || maxSizeBytes > Number.MAX_SAFE_INTEGER) {
      fail('INVALID_VALUE');
    }

    if ('maxImageWidth' in validation) {
      const maxImageWidth = validation.maxImageWidth;
      if (!isInteger(maxImageWidth) || maxImageWidth < 1) {
        fail('INVALID_VALUE');
      }
    }

    if ('maxImageHeight' in validation) {
      const maxImageHeight = validation.maxImageHeight;
      if (!isInteger(maxImageHeight) || maxImageHeight < 1) {
        fail('INVALID_VALUE');
      }
    }

    const allImages = normalizedContentTypes.every((contentType) =>
      contentType.startsWith('image/'),
    );
    if (('maxImageWidth' in validation || 'maxImageHeight' in validation) && !allImages) {
      fail('INVALID_VALUE');
    }
  },
  normalizeField(context, fail: FailWorkflow) {
    if (!context.includeRequired || context.required !== true) {
      fail('INVALID_VALUE');
    }

    if (context.validation === undefined) {
      fail('INVALID_VALUE');
    }

    const validation = context.validation as Record<string, unknown>;

    return buildFieldEnvelope(context, 'file', {
      validation: {
        ...(validation as FileValidation),
        contentTypes: normalizeContentTypes(validation),
      },
    });
  },
  buildDataSchema(): JsonSchemaFragment {
    return { type: 'string', minLength: 1 };
  },
} as const satisfies WorkflowFieldTypeDefinition;
