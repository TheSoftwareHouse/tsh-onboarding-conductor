import { isPlainObject } from '../../value-guards';
import { asConfigObject, readOptionalBoolean, readString } from '../node-config.utils';
import {
  compileSingleOutcomeStep,
  SINGLE_OUTCOME_PORTS,
  SINGLE_STEP_KEYS,
} from '../node-step.utils';
import { capitalize } from '../node-naming';
import type {
  FailWorkflow,
  JsonSchemaFragment,
  NodeFieldMap,
  WorkflowNodePort,
  WorkflowNodeTypeDefinition,
} from '../node-type.port';

/**
 * The verb the acknowledgement field is named after. Terms are *accepted*, a privacy notice is
 * *acknowledged*, marketing is *consented* to — the distinction is legal rather than cosmetic, so
 * the field name carries it.
 */
const ACKNOWLEDGEMENT_VERBS = ['accepted', 'acknowledged', 'consent'] as const;

type AcknowledgementVerb = (typeof ACKNOWLEDGEMENT_VERBS)[number];

export type ConsentDeclaration = {
  readonly key: string;
  /**
   * The document revision the applicant is agreeing to. Pinned as the only accepted value, so a
   * submit carrying an older revision is refused rather than recorded as consent to the current
   * one — which is the whole evidentiary point of collecting it.
   */
  readonly version?: string;
  readonly acknowledgement: AcknowledgementVerb;
  readonly required: boolean;
};

export type ConsentsNodeConfig = {
  readonly consents: readonly ConsentDeclaration[];
};

const parseConsent = (value: unknown, fail: FailWorkflow): ConsentDeclaration => {
  if (!isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  const source = value as Record<string, unknown>;
  const acknowledgement = source.acknowledgement ?? 'accepted';

  if (!ACKNOWLEDGEMENT_VERBS.includes(acknowledgement as AcknowledgementVerb)) {
    fail('INVALID_VALUE');
  }

  return {
    key: readString(source.key, fail),
    version: source.version === undefined ? undefined : readString(source.version, fail),
    acknowledgement: acknowledgement as AcknowledgementVerb,
    required: readOptionalBoolean(source.required, fail) ?? true,
  };
};

/**
 * Terms, privacy notices and marketing opt-ins, each as a pinned version plus the acknowledgement
 * of it. Five of the seven fields on the hand-written `collect_contact` step were this, and
 * getting the pinning wrong — a free-text version, or an acknowledgement that accepts `false` — is
 * the failure that makes the record worthless months later.
 */
export const consentsNodeTypeDefinition = {
  type: 'consents',
  category: 'collect',
  composable: true,
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['consents'],
      properties: {
        consents: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key'],
            properties: {
              key: { type: 'string', minLength: 1 },
              version: { type: 'string', minLength: 1 },
              acknowledgement: { enum: [...ACKNOWLEDGEMENT_VERBS] },
              required: { type: 'boolean' },
            },
          },
        },
      },
    };
  },
  parseConfig(config, fail): ConsentsNodeConfig {
    const source = asConfigObject(config, fail);

    if (!Array.isArray(source.consents) || source.consents.length === 0) {
      fail('INVALID_VALUE');
    }

    const consents = (source.consents as readonly unknown[]).map((entry) =>
      parseConsent(entry, fail),
    );
    const keys = new Set(consents.map((consent) => consent.key));

    if (keys.size !== consents.length) {
      fail('DUPLICATE_FIELD_NAME');
    }

    return { consents };
  },
  listPorts(): readonly WorkflowNodePort[] {
    return SINGLE_OUTCOME_PORTS;
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(config: ConsentsNodeConfig): NodeFieldMap {
    const fields: NodeFieldMap = {};

    for (const consent of config.consents) {
      if (consent.version !== undefined) {
        fields[`${consent.key}Version`] = {
          type: 'text',
          required: true,
          validation: { oneOf: [consent.version] },
        };
      }

      fields[`${consent.key}${capitalize(consent.acknowledgement)}`] = consent.required
        ? { type: 'boolean', required: true, validation: { oneOf: [true] } }
        : { type: 'boolean', required: false };
    }

    return fields;
  },
  compile: compileSingleOutcomeStep,
} as const satisfies WorkflowNodeTypeDefinition<ConsentsNodeConfig>;
