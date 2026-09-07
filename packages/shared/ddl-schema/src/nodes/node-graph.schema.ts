import { buildFieldSchemaDefinitions } from '../schema/workflow-json-schema.builder';
import { getFieldTypeRegistryVersion } from '../fields/field-type.registry';
import { getFieldFormatRegistryVersion } from '../formats/field-format.registry';
import type { JsonSchemaFragment } from './node-type.port';
import { getNodeTypeRegistryVersion, listNodeTypes } from './node-type.registry';

/** Named so a node type's `fields` config can point at the same union step data uses. */
const ROOT_FIELD_DESCRIPTOR = 'rootFieldDescriptor';

/**
 * What a node — and any step it generates — may be called. Stricter than a hand-written step's
 * name on purpose: a node name is new surface with no documents to keep compatible, it becomes part
 * of generated step names, and a canvas has to be able to print it. `safeName` still applies on
 * top, so `constructor` is refused here as everywhere else.
 */
const NODE_NAME_PATTERN = '^[A-Za-z0-9_-]+$';

const nodeNameSchema = (): JsonSchemaFragment => ({
  allOf: [{ $ref: '#/definitions/safeName' }, { type: 'string', pattern: NODE_NAME_PATTERN }],
});

/**
 * One `if type is X then its config is X's schema` arm. `config` is also required whenever X's own
 * schema names required keys, so a node omitting a compulsory config block fails here — naming the
 * node and the type — rather than inside `parseConfig` with only a reason code.
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
 * The authored contract: a graph of typed nodes. Composed from the node-type registry the same way
 * the step schema is composed from the field-type registry, so mounting a node type reaches the
 * published schema — and a builder's config forms — without anyone editing JSON by hand.
 */
export const buildNodeGraphJsonSchema = (): Record<string, unknown> => {
  const { definitions, descriptorRefsByLevel } = buildFieldSchemaDefinitions();
  const nodeTypes = listNodeTypes();
  const composableTypes = nodeTypes.filter((nodeType) => nodeType.composable === true);

  definitions[ROOT_FIELD_DESCRIPTOR] = { anyOf: descriptorRefsByLevel.root };

  definitions.nodeInclude = {
    type: 'object',
    additionalProperties: false,
    required: ['type'],
    properties: {
      type: { enum: composableTypes.map((nodeType) => nodeType.type) },
      config: { type: 'object' },
    },
    allOf: composableTypes.map((nodeType) =>
      buildConfigArm(nodeType.type, nodeType.buildConfigSchema()),
    ),
  };

  // One arm of a conditional edge. A transition's `when`, so a score leaf is legal here too.
  definitions.nodeEdgeArm = {
    type: 'object',
    additionalProperties: false,
    required: ['target'],
    properties: {
      when: { $ref: '#/definitions/transitionCondition' },
      target: nodeNameSchema(),
    },
  };

  definitions.nodeEdge = {
    anyOf: [
      nodeNameSchema(),
      { type: 'array', minItems: 1, items: { $ref: '#/definitions/nodeEdgeArm' } },
    ],
  };

  definitions.node = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'type'],
    properties: {
      name: nodeNameSchema(),
      type: { enum: nodeTypes.map((nodeType) => nodeType.type) },
      config: { type: 'object' },
      include: { type: 'array', minItems: 1, items: { $ref: '#/definitions/nodeInclude' } },
      // No `minProperties`: an empty map is structurally fine, and an unwired port is a graph
      // error the compiler reports as INVALID_TRANSITIONS rather than an opaque schema failure.
      steps: {
        type: 'object',
        propertyNames: { minLength: 1 },
        additionalProperties: nodeNameSchema(),
      },
      edges: {
        type: 'object',
        propertyNames: { minLength: 1 },
        additionalProperties: { $ref: '#/definitions/nodeEdge' },
      },
      // Carried, never read: whatever a builder needs to keep beside a node.
      meta: { $ref: '#/definitions/jsonObject' },
    },
    allOf: nodeTypes.map((nodeType) => buildConfigArm(nodeType.type, nodeType.buildConfigSchema())),
  };

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://tsh.dev/schemas/onboarding-workflow-nodes.schema.json',
    title: 'Onboarding workflow (node graph)',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'version', 'name', 'nodes'],
    properties: {
      id: { type: 'string', minLength: 1 },
      version: { type: 'integer', minimum: 1 },
      name: { type: 'string', minLength: 1 },
      initial: nodeNameSchema(),
      webhook: { $ref: '#/definitions/rootWebhookDeclaration' },
      scoring: {
        type: 'object',
        propertyNames: { $ref: '#/definitions/safeName' },
        additionalProperties: { $ref: '#/definitions/scoreDeclaration' },
      },
      meta: { $ref: '#/definitions/jsonObject' },
      nodes: { type: 'array', minItems: 1, items: { $ref: '#/definitions/node' } },
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
 * Keyed to all three registries: a node type's config schema may reference a field descriptor or a
 * text format, so a stale schema after any of them is mounted would silently reject a valid
 * document.
 */
const getRegistryVersion = (): string =>
  `${getNodeTypeRegistryVersion()}:${getFieldTypeRegistryVersion()}:${getFieldFormatRegistryVersion()}`;

export const getNodeGraphJsonSchema = (): Record<string, unknown> => {
  const registryVersion = getRegistryVersion();

  if (cached?.registryVersion !== registryVersion) {
    cached = { registryVersion, schema: buildNodeGraphJsonSchema() };
  }

  return cached.schema;
};
