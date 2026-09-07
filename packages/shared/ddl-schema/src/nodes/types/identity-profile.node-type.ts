import {
  asConfigObject,
  readEnum,
  readOptionalPositiveInteger,
  readPositiveInteger,
} from '../node-config.utils';
import {
  compileSingleOutcomeStep,
  SINGLE_OUTCOME_PORTS,
  SINGLE_STEP_KEYS,
} from '../node-step.utils';
import type {
  DateValidation,
  JsonSchemaFragment,
  NodeFieldMap,
  NodePublication,
  WorkflowNodePort,
  WorkflowNodeTypeDefinition,
} from '../node-type.port';
import { COUNTRY_PRESET_NAMES, resolveCountryList } from '../presets/country.preset';

/** Whether the node asks for middle names, and whether an answer is compulsory. */
const MIDDLE_NAME_MODES = ['optional', 'required', 'omitted'] as const;

type MiddleNameMode = (typeof MIDDLE_NAME_MODES)[number];

const DEFAULT_NAME_MAX_LENGTH = 100;

export type IdentityProfileNodeConfig = {
  readonly nationalities: readonly string[];
  readonly middleNames: MiddleNameMode;
  readonly maxNameLength: number;
  readonly minAgeYears?: number;
  readonly maxAgeYears?: number;
};

/**
 * The attributes that identify a natural person: legal name, date of birth, nationality. Emitted
 * under canonical field names and published as canonical roles, which is what lets a downstream
 * `kyc` node build its applicant payload without the author restating a mapping.
 *
 * Age is bounded in whole years from the day of submission rather than against a cut-off date: an
 * absolute date would be correct only on the day it was written.
 */
export const identityProfileNodeTypeDefinition = {
  type: 'identity-profile',
  category: 'collect',
  composable: true,
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['nationalities'],
      properties: {
        nationalities: {
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
        middleNames: { enum: [...MIDDLE_NAME_MODES] },
        maxNameLength: { type: 'integer', minimum: 1 },
        minAgeYears: { type: 'integer', minimum: 1 },
        maxAgeYears: { type: 'integer', minimum: 1 },
      },
    };
  },
  parseConfig(config, fail): IdentityProfileNodeConfig {
    const source = asConfigObject(config, fail);
    const minAgeYears = readOptionalPositiveInteger(source.minAgeYears, fail);
    const maxAgeYears = readOptionalPositiveInteger(source.maxAgeYears, fail);

    if (minAgeYears !== undefined && maxAgeYears !== undefined && minAgeYears > maxAgeYears) {
      fail('INVALID_VALUE');
    }

    return {
      nationalities: resolveCountryList(source.nationalities, fail),
      middleNames: readEnum(source.middleNames, MIDDLE_NAME_MODES, 'optional', fail),
      maxNameLength:
        source.maxNameLength === undefined
          ? DEFAULT_NAME_MAX_LENGTH
          : readPositiveInteger(source.maxNameLength, fail),
      minAgeYears,
      maxAgeYears,
    };
  },
  listPorts(): readonly WorkflowNodePort[] {
    return SINGLE_OUTCOME_PORTS;
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(config: IdentityProfileNodeConfig): NodeFieldMap {
    const { maxNameLength } = config;
    const ageValidation: DateValidation = {
      ...(config.minAgeYears === undefined ? {} : { minAgeYears: config.minAgeYears }),
      ...(config.maxAgeYears === undefined ? {} : { maxAgeYears: config.maxAgeYears }),
    };

    const fields: NodeFieldMap = {
      firstName: {
        type: 'text',
        required: true,
        validation: { minLength: 1, maxLength: maxNameLength },
      },
    };

    if (config.middleNames === 'required') {
      fields.middleNames = {
        type: 'text',
        required: true,
        validation: { minLength: 1, maxLength: maxNameLength },
      };
    }

    if (config.middleNames === 'optional') {
      // No `minLength`: an unanswered optional field is absent, never an empty string, so a lower
      // bound here would only reject a name that happens to be short.
      fields.middleNames = {
        type: 'text',
        required: false,
        validation: { maxLength: maxNameLength },
      };
    }

    fields.lastName = {
      type: 'text',
      required: true,
      validation: { minLength: 1, maxLength: maxNameLength },
    };
    fields.dateOfBirth = {
      type: 'date',
      required: true,
      ...(Object.keys(ageValidation).length === 0 ? {} : { validation: ageValidation }),
    };
    fields.nationality = {
      type: 'text',
      required: true,
      validation: { oneOf: [...config.nationalities] },
    };

    return fields;
  },
  publish(config: IdentityProfileNodeConfig): NodePublication {
    return {
      canonicalFields: {
        firstName: 'firstName',
        ...(config.middleNames === 'omitted' ? {} : { middleNames: 'middleNames' }),
        lastName: 'lastName',
        dateOfBirth: 'dateOfBirth',
        nationality: 'nationality',
      },
    };
  },
  compile: compileSingleOutcomeStep,
} as const satisfies WorkflowNodeTypeDefinition<IdentityProfileNodeConfig>;
