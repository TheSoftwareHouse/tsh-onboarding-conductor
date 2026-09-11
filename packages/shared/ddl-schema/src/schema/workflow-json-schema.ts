import { getFieldTypeRegistryVersion } from '../fields/field-type.registry';
import { getFieldFormatRegistryVersion } from '../formats/field-format.registry';
import type { JsonSchemaFragment } from '../step-types/step-type.port';
import { getStepTypeRegistryVersion, listStepTypes } from '../step-types/step-type.registry';
import { buildFieldSchemaDefinitions } from './workflow-json-schema.builder';

/** Named so a step type's `fields` config can point at the same union step data uses. */
const ROOT_FIELD_DESCRIPTOR = 'rootFieldDescriptor';

/**
 * What a step — and any compiled step it generates — may be called. Stricter than the compiled
 * form's `safeName` on purpose: an authored step name is new surface with no documents to keep
 * compatible, it becomes part of generated step names, and a canvas has to be able to print it.
 * `safeName` still applies on top, so `constructor` is refused here as everywhere else.
 */
const STEP_NAME_PATTERN = '^[A-Za-z0-9_-]+$';

const stepNameSchema = (): JsonSchemaFragment => ({
  allOf: [{ $ref: '#/definitions/safeName' }, { type: 'string', pattern: STEP_NAME_PATTERN }],
});

/**
 * One `if type is X then its config is X's schema` arm. `config` is also required whenever X's own
 * schema names required keys, so a step omitting a compulsory config block fails here — naming the
 * step and the type — rather than inside `parseConfig` with only a reason code.
 */
const buildConfigArm = (typeName: string, configSchema: JsonSchemaFragment): JsonSchemaFragment => {
  const required = (configSchema.required as readonly string[] | undefined) ?? [];

  return {
    if: { properties: { type: { const: typeName } }, required: ['type'] },
    then: {
      properties: { config: configSchema },
      ...(required.length === 0 ? {} : { required: ['config'] }),
    },
  };
};

/**
 * The authored contract: typed steps wired by their ports. Composed from the step-type registry the
 * same way the compiled schema is composed from the field-type registry, so mounting a step type
 * reaches the published schema — and a builder's config forms — without anyone editing JSON by hand.
 */
export const buildWorkflowJsonSchema = (): Record<string, unknown> => {
  const { definitions, descriptorRefsByLevel } = buildFieldSchemaDefinitions();
  const stepTypes = listStepTypes();
  const composableTypes = stepTypes.filter((stepType) => stepType.composable === true);

  definitions[ROOT_FIELD_DESCRIPTOR] = { anyOf: descriptorRefsByLevel.root };

  definitions.stepInclude = {
    type: 'object',
    additionalProperties: false,
    required: ['type'],
    properties: {
      type: { enum: composableTypes.map((stepType) => stepType.type) },
      config: { type: 'object' },
    },
    allOf: composableTypes.map((stepType) =>
      buildConfigArm(stepType.type, stepType.buildConfigSchema()),
    ),
  };

  // One arm of a conditional edge. A transition's `when`, so a score leaf is legal here too, and a
  // transition's `webhook`, so an arm can opt out of the client notification the way a step's
  // transition can.
  definitions.stepEdgeArm = {
    type: 'object',
    additionalProperties: false,
    required: ['target'],
    properties: {
      when: { $ref: '#/definitions/transitionCondition' },
      target: stepNameSchema(),
      webhook: { $ref: '#/definitions/transitionWebhookDeclaration' },
    },
  };

  definitions.stepEdge = {
    anyOf: [
      stepNameSchema(),
      { type: 'array', minItems: 1, items: { $ref: '#/definitions/stepEdgeArm' } },
    ],
  };

  definitions.step = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'type'],
    properties: {
      name: stepNameSchema(),
      type: { enum: stepTypes.map((stepType) => stepType.type) },
      config: { type: 'object' },
      include: { type: 'array', minItems: 1, items: { $ref: '#/definitions/stepInclude' } },
      // No `minProperties`: an empty map is structurally fine, and an unwired port is a graph
      // error the compiler reports as INVALID_TRANSITIONS rather than an opaque schema failure.
      // The keys pass `safeName`: a port or sub-step key called `__proto__` is a name the document
      // invents, and one a plain object cannot even hold as its own property.
      substeps: {
        type: 'object',
        propertyNames: { $ref: '#/definitions/safeName' },
        additionalProperties: stepNameSchema(),
      },
      edges: {
        type: 'object',
        propertyNames: { $ref: '#/definitions/safeName' },
        additionalProperties: { $ref: '#/definitions/stepEdge' },
      },
      // The compiled form's own rule shape; which step carries them is the step type's call.
      scoring: { type: 'array', minItems: 1, items: { $ref: '#/definitions/scoringRule' } },
      // Carried, never read: whatever a builder needs to keep beside a step.
      meta: { $ref: '#/definitions/jsonObject' },
    },
    allOf: stepTypes.map((stepType) => buildConfigArm(stepType.type, stepType.buildConfigSchema())),
  };

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://tsh.dev/schemas/onboarding-workflow.schema.json',
    title: 'Onboarding workflow',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'version', 'name', 'steps'],
    properties: {
      id: { type: 'string', minLength: 1 },
      version: { type: 'integer', minimum: 1 },
      name: { type: 'string', minLength: 1 },
      initial: stepNameSchema(),
      webhook: { $ref: '#/definitions/rootWebhookDeclaration' },
      scoring: {
        type: 'object',
        propertyNames: { $ref: '#/definitions/safeName' },
        additionalProperties: { $ref: '#/definitions/scoreDeclaration' },
      },
      meta: { $ref: '#/definitions/jsonObject' },
      steps: { type: 'array', minItems: 1, items: { $ref: '#/definitions/step' } },
    },
    definitions,
  };
};

type CachedSchema = {
  registryVersion: string;
  schema: Record<string, unknown>;
};

let cached: CachedSchema | undefined;

/**
 * Keyed to all three registries: a step type's config schema may reference a field descriptor or a
 * text format, so a stale schema after any of them is mounted would silently reject a valid
 * document.
 */
const getRegistryVersion = (): string =>
  `${getStepTypeRegistryVersion()}:${getFieldTypeRegistryVersion()}:${getFieldFormatRegistryVersion()}`;

/** The schema a document is validated against before it compiles, and the one served to a builder. */
export const getWorkflowJsonSchema = (): Record<string, unknown> => {
  const registryVersion = getRegistryVersion();

  if (cached?.registryVersion !== registryVersion) {
    cached = { registryVersion, schema: buildWorkflowJsonSchema() };
  }

  return cached.schema;
};
