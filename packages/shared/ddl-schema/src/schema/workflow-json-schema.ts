import { getFieldTypeRegistryVersion } from '../fields/field-type.registry';
import { getFieldFormatRegistryVersion } from '../formats/field-format.registry';
import { buildWorkflowJsonSchema } from './workflow-json-schema.builder';

type CachedSchema = {
  registryVersion: string;
  schema: Record<string, unknown>;
};

const getRegistryVersion = (): string =>
  `${getFieldTypeRegistryVersion()}:${getFieldFormatRegistryVersion()}`;

let cached: CachedSchema | undefined;

/**
 * The workflow contract, composed from the registries in memory. Built on first use rather than at
 * module load, so field types and formats mounted during startup are included, and rebuilt if the
 * registries change afterwards.
 */
export const getWorkflowJsonSchema = (): Record<string, unknown> => {
  const registryVersion = getRegistryVersion();

  if (cached?.registryVersion !== registryVersion) {
    cached = { registryVersion, schema: buildWorkflowJsonSchema() };
  }

  return cached.schema;
};
