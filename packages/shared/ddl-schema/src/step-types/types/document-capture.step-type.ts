import { isInteger } from '../../value-guards';
import type { CompiledWorkflowStep } from '../../workflow-contract';
import { asConfigObject, readString, SUCCESS_PORT } from '../step-config.utils';
import { capitalize, toCamelCase } from '../step-naming';
import { buildSuccessTransition, SINGLE_OUTCOME_PORTS } from '../step-compile.utils';
import type {
  FileValidation,
  JsonSchemaFragment,
  StepFieldMap,
  StepPublication,
  PublishedDocument,
  WorkflowStepCompilationContext,
  WorkflowStepPort,
  WorkflowStepTypeDefinition,
} from '../step-type.port';
import {
  DEFAULT_DOCUMENT_CONTENT_TYPES,
  resolveUploadValidation,
  uploadValidationSchema,
} from '../presets/upload.preset';

/** Sub-step keys a two-sided document compiles to; the front is the entry. */
const SIDE_KEYS = ['front', 'back'] as const;

const SIDE_SUFFIXES = { front: 'FRONT_SIDE', back: 'BACK_SIDE' } as const;

export type DocumentCaptureStepConfig = {
  readonly document: string;
  readonly sides: 1 | 2;
  readonly validation: FileValidation;
};

/** `PASSPORT` with one side → `passportDocument`; `ID_CARD` with two → `idCardFront`, `idCardBack`. */
export const buildCaptureFieldName = (docType: string, side?: 'front' | 'back'): string => {
  const stem = toCamelCase(docType);

  return side === undefined ? `${stem}Document` : `${stem}${capitalize(side)}`;
};

/**
 * Capturing one identity document. A two-sided document is two uploads on two steps, because a
 * step accepts at most one file field — so `sides: 2` replaces the pair of near-identical
 * hand-written steps an ID card needed, and the second one's edge is wired for the author.
 *
 * What the step publishes is the load-bearing part: the field, the slot and the side. A downstream
 * `kyc` step builds its whole document list from those publications rather than from a config
 * table restating what the capture steps already say.
 */
export const documentCaptureStepTypeDefinition = {
  type: 'document-capture',
  category: 'collect',
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['document'],
      properties: {
        document: { type: 'string', minLength: 1 },
        sides: { enum: [1, 2] },
        ...uploadValidationSchema(),
      },
    };
  },
  parseConfig(config, fail): DocumentCaptureStepConfig {
    const source = asConfigObject(config, fail);
    const sides = source.sides ?? 1;

    if (!isInteger(sides) || (sides !== 1 && sides !== 2)) {
      fail('INVALID_VALUE');
    }

    return {
      document: readString(source.document, fail),
      sides: sides as 1 | 2,
      validation: resolveUploadValidation(
        source.contentTypes,
        source.maxSizeBytes,
        DEFAULT_DOCUMENT_CONTENT_TYPES,
        fail,
      ),
    };
  },
  listPorts(): readonly WorkflowStepPort[] {
    return SINGLE_OUTCOME_PORTS;
  },
  listSubStepKeys(config: DocumentCaptureStepConfig): readonly (string | null)[] {
    return config.sides === 1 ? [null] : [...SIDE_KEYS];
  },
  buildFields(config: DocumentCaptureStepConfig): StepFieldMap {
    const field = buildCaptureFieldName(config.document, config.sides === 1 ? undefined : 'front');

    return { [field]: { type: 'file', required: true, validation: config.validation } };
  },
  publish(config: DocumentCaptureStepConfig): StepPublication {
    if (config.sides === 1) {
      return {
        documents: [
          {
            field: buildCaptureFieldName(config.document),
            docSetType: 'IDENTITY',
            docType: config.document,
          },
        ],
      };
    }

    const documents: PublishedDocument[] = SIDE_KEYS.map((side) => ({
      field: buildCaptureFieldName(config.document, side),
      docSetType: 'IDENTITY',
      docType: config.document,
      side: SIDE_SUFFIXES[side],
    }));

    return { documents };
  },
  compile(
    context: WorkflowStepCompilationContext<DocumentCaptureStepConfig>,
  ): CompiledWorkflowStep[] {
    const onwards = buildSuccessTransition(context.targets[SUCCESS_PORT]);

    if (context.config.sides === 1) {
      return [
        {
          name: context.stepNames[0],
          status: 'awaiting_user',
          data: context.fields,
          transitions: [onwards],
        },
      ];
    }

    const backField = buildCaptureFieldName(context.config.document, 'back');

    return [
      {
        name: context.stepNames[0],
        status: 'awaiting_user',
        data: context.fields,
        transitions: [buildSuccessTransition(context.stepNames[1])],
      },
      {
        name: context.stepNames[1],
        status: 'awaiting_user',
        data: {
          [backField]: { type: 'file', required: true, validation: context.config.validation },
        },
        transitions: [onwards],
      },
    ];
  },
} as const satisfies WorkflowStepTypeDefinition<DocumentCaptureStepConfig>;
