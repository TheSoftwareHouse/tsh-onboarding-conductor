import { isPlainObject } from '../../value-guards';
import { asConfigObject, fieldMapSchema, readFieldMap, readString } from '../step-config.utils';
import {
  compileSingleOutcomeStep,
  SINGLE_OUTCOME_PORTS,
  SINGLE_STEP_KEYS,
} from '../step-compile.utils';
import {
  CANONICAL_FIELD_ROLES,
  type CanonicalFieldMap,
  type CanonicalFieldRole,
  type FailWorkflow,
  type JsonSchemaFragment,
  type StepFieldMap,
  type StepPublication,
  type WorkflowStepPort,
  type WorkflowStepTypeDefinition,
} from '../step-type.port';

export type FormStepConfig = {
  readonly fields: StepFieldMap;
  /** Roles these fields fill, so a downstream step finds them without a restated mapping. */
  readonly canonical: CanonicalFieldMap;
};

const parseCanonical = (
  value: unknown,
  fields: StepFieldMap,
  fail: FailWorkflow,
): CanonicalFieldMap => {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  const canonical: CanonicalFieldMap = {};

  for (const [role, fieldName] of Object.entries(value as Record<string, unknown>)) {
    if (!CANONICAL_FIELD_ROLES.includes(role as CanonicalFieldRole)) {
      fail('INVALID_VALUE');
    }

    const claimed = readString(fieldName, fail);
    // A role pointing at a field this step does not declare would resolve to nothing downstream.
    if (!Object.prototype.hasOwnProperty.call(fields, claimed)) {
      fail('INVALID_VALUE');
    }

    canonical[role as CanonicalFieldRole] = claimed;
  }

  return canonical;
};

/**
 * The unspecialized collection step: whatever fields the author writes, on one `awaiting_user`
 * step. It is both the escape hatch for data no specialized fragment covers and the fragment that
 * lets a specialized step's step carry one extra bespoke field.
 */
export const formStepTypeDefinition = {
  type: 'form',
  category: 'collect',
  composable: true,
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['fields'],
      properties: {
        fields: fieldMapSchema(),
        canonical: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(
            CANONICAL_FIELD_ROLES.map((role) => [role, { type: 'string', minLength: 1 }]),
          ),
        },
      },
    };
  },
  parseConfig(config, fail): FormStepConfig {
    const source = asConfigObject(config, fail);
    const fields = readFieldMap(source.fields, fail) as StepFieldMap;

    return { fields, canonical: parseCanonical(source.canonical, fields, fail) };
  },
  listPorts(): readonly WorkflowStepPort[] {
    return SINGLE_OUTCOME_PORTS;
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(config: FormStepConfig): StepFieldMap {
    return { ...config.fields };
  },
  publish(config: FormStepConfig): StepPublication {
    return { canonicalFields: config.canonical };
  },
  compile: compileSingleOutcomeStep,
} as const satisfies WorkflowStepTypeDefinition<FormStepConfig>;
