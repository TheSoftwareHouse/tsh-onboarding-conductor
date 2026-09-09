import { isPlainObject } from '../../value-guards';
import { asConfigObject, fieldMapSchema, readFieldMap, readString } from '../node-config.utils';
import {
  compileSingleOutcomeStep,
  SINGLE_OUTCOME_PORTS,
  SINGLE_STEP_KEYS,
} from '../node-step.utils';
import {
  CANONICAL_FIELD_ROLES,
  type CanonicalFieldMap,
  type CanonicalFieldRole,
  type FailWorkflow,
  type JsonSchemaFragment,
  type NodeFieldMap,
  type NodePublication,
  type WorkflowNodePort,
  type WorkflowNodeTypeDefinition,
} from '../node-type.port';

export type FormNodeConfig = {
  readonly fields: NodeFieldMap;
  /** Roles these fields fill, so a downstream node finds them without a restated mapping. */
  readonly canonical: CanonicalFieldMap;
};

const parseCanonical = (
  value: unknown,
  fields: NodeFieldMap,
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
    // A role pointing at a field this node does not declare would resolve to nothing downstream.
    if (!Object.prototype.hasOwnProperty.call(fields, claimed)) {
      fail('INVALID_VALUE');
    }

    canonical[role as CanonicalFieldRole] = claimed;
  }

  return canonical;
};

/**
 * The unspecialized collection node: whatever fields the author writes, on one `awaiting_user`
 * step. It is both the escape hatch for data no specialized fragment covers and the fragment that
 * lets a specialized node's step carry one extra bespoke field.
 */
export const formNodeTypeDefinition = {
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
  parseConfig(config, fail): FormNodeConfig {
    const source = asConfigObject(config, fail);
    const fields = readFieldMap(source.fields, fail) as NodeFieldMap;

    return { fields, canonical: parseCanonical(source.canonical, fields, fail) };
  },
  listPorts(): readonly WorkflowNodePort[] {
    return SINGLE_OUTCOME_PORTS;
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(config: FormNodeConfig): NodeFieldMap {
    return { ...config.fields };
  },
  publish(config: FormNodeConfig): NodePublication {
    return { canonicalFields: config.canonical };
  },
  compile: compileSingleOutcomeStep,
} as const satisfies WorkflowNodeTypeDefinition<FormNodeConfig>;
