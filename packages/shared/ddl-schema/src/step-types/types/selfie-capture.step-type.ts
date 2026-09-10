import { asConfigObject, readOptionalString } from '../step-config.utils';
import {
  compileSingleOutcomeStep,
  SINGLE_OUTCOME_PORTS,
  SINGLE_STEP_KEYS,
} from '../step-compile.utils';
import type {
  FileValidation,
  JsonSchemaFragment,
  StepFieldMap,
  StepPublication,
  WorkflowStepPort,
  WorkflowStepTypeDefinition,
} from '../step-type.port';
import {
  DEFAULT_SELFIE_CONTENT_TYPES,
  resolveUploadValidation,
  uploadValidationSchema,
} from '../presets/upload.preset';

const DEFAULT_SELFIE_FIELD = 'selfieDocument';

/** The document type a selfie fills its own slot with. */
const SELFIE_DOC_TYPE = 'SELFIE';

export type SelfieCaptureStepConfig = {
  readonly field: string;
  readonly validation: FileValidation;
};

/**
 * The applicant's own photograph, in its own slot rather than the identity one — which is what a
 * provider needs to compare a face against a document instead of treating it as a second document.
 *
 * Whether the capture is a still, an active-liveness sequence or an NFC chip read is a property of
 * the provider's level, not of this step: nothing in the engine would read it, so nothing here
 * declares it.
 */
export const selfieCaptureStepTypeDefinition = {
  type: 'selfie-capture',
  category: 'collect',
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        field: { type: 'string', minLength: 1 },
        ...uploadValidationSchema(),
      },
    };
  },
  parseConfig(config, fail): SelfieCaptureStepConfig {
    const source = asConfigObject(config, fail);

    return {
      field: readOptionalString(source.field, fail) ?? DEFAULT_SELFIE_FIELD,
      validation: resolveUploadValidation(
        source.contentTypes,
        source.maxSizeBytes,
        DEFAULT_SELFIE_CONTENT_TYPES,
        fail,
      ),
    };
  },
  listPorts(): readonly WorkflowStepPort[] {
    return SINGLE_OUTCOME_PORTS;
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(config: SelfieCaptureStepConfig): StepFieldMap {
    return { [config.field]: { type: 'file', required: true, validation: config.validation } };
  },
  publish(config: SelfieCaptureStepConfig): StepPublication {
    return {
      documents: [{ field: config.field, docSetType: 'SELFIE', docType: SELFIE_DOC_TYPE }],
    };
  },
  compile: compileSingleOutcomeStep,
} as const satisfies WorkflowStepTypeDefinition<SelfieCaptureStepConfig>;
