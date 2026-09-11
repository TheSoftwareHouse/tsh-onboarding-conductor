import { isPlainObject } from '../../value-guards';
import type {
  RawWorkflowConnectorDeclaration,
  CompiledWorkflowStep,
  RawWorkflowTransition,
} from '../../workflow-contract';
import {
  asConfigObject,
  fieldMapSchema,
  readFieldMap,
  readObjectList,
  readString,
  SUCCESS_PORT,
} from '../step-config.utils';
import { buildSuccessTransition, SINGLE_STEP_KEYS } from '../step-compile.utils';
import {
  CANONICAL_FIELD_ROLES,
  type CanonicalFieldMap,
  type CanonicalFieldRole,
  type FailWorkflow,
  type JsonSchemaFragment,
  type StepFieldMap,
  type StepPublication,
  type WorkflowStepCompilationContext,
  type WorkflowStepPort,
  type WorkflowStepTypeDefinition,
} from '../step-type.port';

/** The port a refusal follows. Exposed only when a connector on the step can refuse at all. */
export const CONNECTOR_CALL_REJECTED_PORT = 'rejected';

export type ConnectorCallStepConfig = {
  readonly fields: StepFieldMap;
  readonly canonical: CanonicalFieldMap;
  readonly connectors: readonly RawWorkflowConnectorDeclaration[];
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

    if (!Object.prototype.hasOwnProperty.call(fields, claimed)) {
      fail('INVALID_VALUE');
    }

    canonical[role as CanonicalFieldRole] = claimed;
  }

  return canonical;
};

const canReject = (connectors: readonly RawWorkflowConnectorDeclaration[]): boolean =>
  connectors.some((connector) => connector.canReject === true);

/**
 * Collecting fields and handing them to any configured connector, declared the way a step declares
 * one: adapter id, capability, mapping, and the whole failure policy. The specialized integration
 * types each derive their declaration from something — a request template, a canonical role, the
 * document contract — and are the better choice when one fits; this is the step for the adapter
 * none of them knows, a mock in a fixture or a provider integrated by declaration alone, without
 * giving up ports for `custom`'s raw transitions.
 *
 * It exposes `rejected` only when a connector declares `canReject`, because the compiled form's rule is
 * that a refusal has somewhere to go exactly when something can refuse — and the compiled step is
 * still held to that rule, so a `rejected` edge here has to lead to a rejected terminal.
 */
export const connectorCallStepTypeDefinition = {
  type: 'connector-call',
  category: 'integrate',
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['connectors'],
      properties: {
        fields: fieldMapSchema(),
        canonical: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(
            CANONICAL_FIELD_ROLES.map((role) => [role, { type: 'string', minLength: 1 }]),
          ),
        },
        connectors: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/definitions/connectorDeclaration' },
        },
      },
    };
  },
  parseConfig(config, fail): ConnectorCallStepConfig {
    const source = asConfigObject(config, fail);
    const fields =
      source.fields === undefined ? {} : (readFieldMap(source.fields, fail) as StepFieldMap);
    const connectors = readObjectList<RawWorkflowConnectorDeclaration>(source.connectors, fail);

    if (connectors.length === 0) {
      fail('INVALID_VALUE');
    }

    return { fields, canonical: parseCanonical(source.canonical, fields, fail), connectors };
  },
  listPorts(config: ConnectorCallStepConfig): readonly WorkflowStepPort[] {
    return [
      { name: SUCCESS_PORT },
      ...(canReject(config.connectors) ? [{ name: CONNECTOR_CALL_REJECTED_PORT }] : []),
    ];
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(config: ConnectorCallStepConfig): StepFieldMap {
    return { ...config.fields };
  },
  publish(config: ConnectorCallStepConfig): StepPublication {
    return { canonicalFields: config.canonical };
  },
  compile(
    context: WorkflowStepCompilationContext<ConnectorCallStepConfig>,
  ): CompiledWorkflowStep[] {
    const { config } = context;
    const transitions: RawWorkflowTransition[] = [
      buildSuccessTransition(context.targets[SUCCESS_PORT]),
    ];

    if (canReject(config.connectors)) {
      transitions.push({
        status: 'rejected',
        target: context.targets[CONNECTOR_CALL_REJECTED_PORT],
      });
    }

    return [
      {
        name: context.stepNames[0],
        status: 'awaiting_user',
        data: context.fields,
        connectors: [...config.connectors],
        transitions,
      },
    ];
  },
} as const satisfies WorkflowStepTypeDefinition<ConnectorCallStepConfig>;
