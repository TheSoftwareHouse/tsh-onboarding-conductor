import {
  asConfigObject,
  readEnum,
  readOptionalBoolean,
  readOptionalString,
  readPositiveInteger,
} from '../node-config.utils';
import { capitalize } from '../node-naming';
import {
  compileSingleOutcomeStep,
  SINGLE_OUTCOME_PORTS,
  SINGLE_STEP_KEYS,
} from '../node-step.utils';
import type {
  CanonicalFieldMap,
  JsonSchemaFragment,
  NodeFieldMap,
  NodePublication,
  WorkflowNodePort,
  WorkflowNodeTypeDefinition,
} from '../node-type.port';
import { COUNTRY_PRESET_NAMES, resolveCountryList } from '../presets/country.preset';

/**
 * Whether the node asks for a sub-national region. `omitted` by default: most EEA addresses have
 * no region, and a required field with nothing to put in it is a dead end.
 */
const REGION_MODES = ['omitted', 'optional', 'required'] as const;

type RegionMode = (typeof REGION_MODES)[number];

const DEFAULT_LENGTHS = { street: 200, town: 100, region: 100, postCode: 20 } as const;

export type AddressNodeConfig = {
  readonly countries: readonly string[];
  readonly street2: boolean;
  readonly region: RegionMode;
  readonly maxStreetLength: number;
  readonly maxTownLength: number;
  readonly maxPostCodeLength: number;
  /**
   * Distinguishes a second address on the same document — `mailing` yields `mailingStreet`,
   * `mailingTown` and so on. Field names are unique across a whole workflow, so without it a
   * document could declare only one address.
   */
  readonly prefix?: string;
};

/**
 * A postal address. Emitted under canonical field names and published as canonical roles, unless
 * the node carries a `prefix` — a prefixed address is a secondary one, and letting it claim the
 * roles would silently hand a provider the applicant's mailing address as their residence.
 */
export const addressNodeTypeDefinition = {
  type: 'address',
  category: 'collect',
  composable: true,
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['countries'],
      properties: {
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
        street2: { type: 'boolean' },
        region: { enum: [...REGION_MODES] },
        maxStreetLength: { type: 'integer', minimum: 1 },
        maxTownLength: { type: 'integer', minimum: 1 },
        maxPostCodeLength: { type: 'integer', minimum: 1 },
        prefix: { type: 'string', pattern: '^[a-z][A-Za-z0-9]*$' },
      },
    };
  },
  parseConfig(config, fail): AddressNodeConfig {
    const source = asConfigObject(config, fail);
    const readLength = (value: unknown, fallback: number): number =>
      value === undefined ? fallback : readPositiveInteger(value, fail);

    return {
      countries: resolveCountryList(source.countries, fail),
      street2: readOptionalBoolean(source.street2, fail) ?? false,
      region: readEnum(source.region, REGION_MODES, 'omitted', fail),
      maxStreetLength: readLength(source.maxStreetLength, DEFAULT_LENGTHS.street),
      maxTownLength: readLength(source.maxTownLength, DEFAULT_LENGTHS.town),
      maxPostCodeLength: readLength(source.maxPostCodeLength, DEFAULT_LENGTHS.postCode),
      prefix: readOptionalString(source.prefix, fail),
    };
  },
  listPorts(): readonly WorkflowNodePort[] {
    return SINGLE_OUTCOME_PORTS;
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(config: AddressNodeConfig): NodeFieldMap {
    const named = (role: string): string =>
      config.prefix === undefined ? role : `${config.prefix}${capitalize(role)}`;
    const fields: NodeFieldMap = {
      [named('street')]: {
        type: 'text',
        required: true,
        validation: { minLength: 1, maxLength: config.maxStreetLength },
      },
    };

    if (config.street2) {
      fields[named('street2')] = {
        type: 'text',
        required: false,
        validation: { maxLength: config.maxStreetLength },
      };
    }

    fields[named('town')] = {
      type: 'text',
      required: true,
      validation: { minLength: 1, maxLength: config.maxTownLength },
    };

    if (config.region !== 'omitted') {
      const required = config.region === 'required';
      fields[named('region')] = {
        type: 'text',
        required,
        validation: required
          ? { minLength: 1, maxLength: DEFAULT_LENGTHS.region }
          : { maxLength: DEFAULT_LENGTHS.region },
      };
    }

    fields[named('postCode')] = {
      type: 'text',
      required: true,
      validation: { minLength: 1, maxLength: config.maxPostCodeLength },
    };
    fields[named('country')] = {
      type: 'text',
      required: true,
      validation: { oneOf: [...config.countries] },
    };

    return fields;
  },
  publish(config: AddressNodeConfig): NodePublication {
    if (config.prefix !== undefined) {
      return {};
    }

    const canonicalFields: CanonicalFieldMap = {
      street: 'street',
      ...(config.street2 ? { street2: 'street2' } : {}),
      town: 'town',
      ...(config.region === 'omitted' ? {} : { region: 'region' }),
      postCode: 'postCode',
      country: 'country',
    };

    return { canonicalFields };
  },
  compile: compileSingleOutcomeStep,
} as const satisfies WorkflowNodeTypeDefinition<AddressNodeConfig>;
