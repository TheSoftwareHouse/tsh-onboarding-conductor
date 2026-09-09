import { asConfigObject, readEnum } from '../node-config.utils';
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

/** Whether an input is asked for, and whether an answer is compulsory. */
const CONTACT_INPUT_MODES = ['required', 'optional', 'omitted'] as const;

type ContactInputMode = (typeof CONTACT_INPUT_MODES)[number];

export type ContactDetailsNodeConfig = {
  readonly email: ContactInputMode;
  readonly phoneNumber: ContactInputMode;
};

/**
 * How the applicant can be reached: an email address, a phone number, or both. Emitted under
 * canonical field names and published as canonical roles, which is what lets a verification node
 * downstream find the number or address to challenge without the author restating it — and what
 * keeps collecting a contact and proving it two separate things on the canvas.
 */
export const contactDetailsNodeTypeDefinition = {
  type: 'contact-details',
  category: 'collect',
  composable: true,
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        email: { enum: [...CONTACT_INPUT_MODES] },
        phoneNumber: { enum: [...CONTACT_INPUT_MODES] },
      },
    };
  },
  parseConfig(config, fail): ContactDetailsNodeConfig {
    const source = asConfigObject(config, fail);
    const parsed: ContactDetailsNodeConfig = {
      email: readEnum(source.email, CONTACT_INPUT_MODES, 'required', fail),
      phoneNumber: readEnum(source.phoneNumber, CONTACT_INPUT_MODES, 'required', fail),
    };

    // A contact node that asks for nothing is a step with no purpose.
    if (parsed.email === 'omitted' && parsed.phoneNumber === 'omitted') {
      fail('INVALID_VALUE');
    }

    return parsed;
  },
  listPorts(): readonly WorkflowNodePort[] {
    return SINGLE_OUTCOME_PORTS;
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(config: ContactDetailsNodeConfig): NodeFieldMap {
    const fields: NodeFieldMap = {};

    if (config.email !== 'omitted') {
      fields.email = {
        type: 'text',
        required: config.email === 'required',
        validation: { format: 'email' },
      };
    }

    if (config.phoneNumber !== 'omitted') {
      fields.phoneNumber = {
        type: 'text',
        required: config.phoneNumber === 'required',
        validation: { format: 'phone' },
      };
    }

    return fields;
  },
  publish(config: ContactDetailsNodeConfig): NodePublication {
    const canonicalFields: CanonicalFieldMap = {
      ...(config.email === 'omitted' ? {} : { email: 'email' }),
      ...(config.phoneNumber === 'omitted' ? {} : { phoneNumber: 'phoneNumber' }),
    };

    return { canonicalFields };
  },
  compile: compileSingleOutcomeStep,
} as const satisfies WorkflowNodeTypeDefinition<ContactDetailsNodeConfig>;
