import { isPlainObject } from '../../value-guards';
import type { RawWorkflowStep, RawWorkflowTransition } from '../../workflow-contract';
import { asConfigObject, readOptionalString, readString } from '../node-config.utils';
import { toCamelCase } from '../node-naming';
import { SINGLE_STEP_KEYS } from '../node-step.utils';
import type {
  FailWorkflow,
  JsonSchemaFragment,
  NodeFieldMap,
  NodePublication,
  PublishedDocumentOption,
  WorkflowNodeCompilationContext,
  WorkflowNodePort,
  WorkflowNodeTypeDefinition,
} from '../node-type.port';
import { COUNTRY_PRESET_NAMES, resolveCountryList } from '../presets/country.preset';

const DEFAULT_CHOICE_FIELD = 'documentType';

export type DocumentChoiceOption = {
  readonly type: string;
  readonly countries: readonly string[];
};

export type DocumentChoiceNodeConfig = {
  readonly field: string;
  readonly documents: readonly DocumentChoiceOption[];
};

/** `PASSPORT` → `passportIssuingCountry`. */
export const buildIssuingCountryField = (docType: string): string =>
  `${toCamelCase(docType)}IssuingCountry`;

const parseOption = (value: unknown, fail: FailWorkflow): DocumentChoiceOption => {
  if (!isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  const source = value as Record<string, unknown>;

  return {
    type: readString(source.type, fail),
    countries: resolveCountryList(source.countries, fail),
  };
};

/**
 * Where the applicant picks which identity document they will present, and which state issued it.
 * One port per document, so the branches are drawn rather than written: the hand-written form of
 * this step spent 116 lines on one enum, two `when`-gated country fields and two conditional
 * transitions, and every one of them had to agree with the others.
 *
 * The transitions it emits are exhaustive and carry no catch-all arm. A document type outside the
 * enum therefore matches nothing and the engine ends the onboarding `invalid`, which is the
 * intended outcome — an "everything else" arm would silently absorb a document added to the enum
 * later and route it to the wrong capture step.
 */
export const documentChoiceNodeTypeDefinition = {
  type: 'document-choice',
  category: 'collect',
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['documents'],
      properties: {
        field: { type: 'string', minLength: 1 },
        documents: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'countries'],
            properties: {
              type: { type: 'string', minLength: 1 },
              countries: {
                anyOf: [
                  { enum: [...COUNTRY_PRESET_NAMES] },
                  {
                    type: 'array',
                    minItems: 1,
                    uniqueItems: true,
                    items: { type: 'string', pattern: '^[A-Z]{2}$' },
                  },
                ],
              },
            },
          },
        },
      },
    };
  },
  parseConfig(config, fail): DocumentChoiceNodeConfig {
    const source = asConfigObject(config, fail);

    if (!Array.isArray(source.documents) || source.documents.length === 0) {
      fail('INVALID_VALUE');
    }

    const documents = (source.documents as readonly unknown[]).map((entry) =>
      parseOption(entry, fail),
    );

    if (new Set(documents.map((document) => document.type)).size !== documents.length) {
      fail('INVALID_VALUE');
    }

    return {
      field: readOptionalString(source.field, fail) ?? DEFAULT_CHOICE_FIELD,
      documents,
    };
  },
  listPorts(config: DocumentChoiceNodeConfig): readonly WorkflowNodePort[] {
    return config.documents.map((document) => ({ name: document.type }));
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(config: DocumentChoiceNodeConfig): NodeFieldMap {
    const fields: NodeFieldMap = {
      [config.field]: {
        type: 'text',
        required: true,
        validation: { oneOf: config.documents.map((document) => document.type) },
      },
    };

    // One offered document is asked of everyone, so it needs no gate — and an ungated field can
    // stay a required connector mapping. Two or more are each gated on the applicant's own choice:
    // the engine omits an unasked field from the payload instead of failing the step.
    const gated = config.documents.length > 1;

    for (const document of config.documents) {
      fields[buildIssuingCountryField(document.type)] = {
        type: 'text',
        required: true,
        ...(gated ? { when: { field: config.field, equals: document.type } } : {}),
        validation: { oneOf: [...document.countries] },
      };
    }

    return fields;
  },
  publish(config: DocumentChoiceNodeConfig): NodePublication {
    const documentOptions: PublishedDocumentOption[] = config.documents.map((document) => ({
      docType: document.type,
      issuingCountryField: buildIssuingCountryField(document.type),
      // One offered document is compulsory; two or more mean each is absent on the other's branch.
      optional: config.documents.length > 1,
    }));

    return { documentOptions };
  },
  compile(context: WorkflowNodeCompilationContext<DocumentChoiceNodeConfig>): RawWorkflowStep[] {
    const transitions: RawWorkflowTransition[] = context.config.documents.map((document) => ({
      status: 'success',
      when: { field: context.config.field, equals: document.type },
      target: context.targets[document.type],
    }));

    return [
      {
        name: context.stepNames[0],
        status: 'awaiting_user',
        data: context.fields,
        transitions,
      },
    ];
  },
} as const satisfies WorkflowNodeTypeDefinition<DocumentChoiceNodeConfig>;
