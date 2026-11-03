import { STEP_TYPE } from '@tsh/ddl-schema/step-types';
import type { WorkflowDocumentInput } from '@/api/workflows/workflow-drafts';

const SOURCE_KEY = 'sourceKey';

/** A connector source key derived from a workflow id, e.g. `eu-b2c-kyc` → `eu_b2c_kyc`. */
export function buildSourceKey(workflowId: string): string {
  return workflowId.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Renames the `sourceKey` the engine reads from each connector declaration to one derived from `workflowId`; shared keys stay shared. */
export function renameSourceKeys(
  document: WorkflowDocumentInput,
  workflowId: string,
): WorkflowDocumentInput {
  const base = buildSourceKey(workflowId);
  const renamed = new Map<string, string>();

  const rename = (key: string): string => {
    const known = renamed.get(key);
    if (known !== undefined) return known;
    const next = renamed.size === 0 ? base : `${base}_${renamed.size + 1}`;
    renamed.set(key, next);
    return next;
  };

  const renameIn = (config: unknown): unknown => {
    if (!isObject(config) || typeof config[SOURCE_KEY] !== 'string') return config;
    return { ...config, [SOURCE_KEY]: rename(config[SOURCE_KEY]) };
  };

  const renameDeclaration = (declaration: JsonObject): JsonObject => ({
    ...declaration,
    ...(declaration.config === undefined ? {} : { config: renameIn(declaration.config) }),
  });

  const renameConnector = (connector: JsonObject): JsonObject => {
    const renamedConnector = renameDeclaration(connector);
    if (!Array.isArray(connector.fallback)) return renamedConnector;
    return {
      ...renamedConnector,
      fallback: connector.fallback.map((fallback) =>
        isObject(fallback) ? renameDeclaration(fallback) : fallback,
      ),
    };
  };

  const renameStep = (step: JsonObject): JsonObject => {
    if (!isObject(step.config)) return step;
    if (step.type === STEP_TYPE.kycIdentityVerification) {
      return { ...step, config: renameIn(step.config) };
    }
    if (step.type === STEP_TYPE.notify) {
      const { connector } = step.config;
      if (!isObject(connector)) return step;
      return { ...step, config: { ...step.config, connector: renameConnector(connector) } };
    }
    if (step.type !== STEP_TYPE.custom && step.type !== STEP_TYPE.connectorCall) return step;
    if (!Array.isArray(step.config.connectors)) return step;
    return {
      ...step,
      config: {
        ...step.config,
        connectors: step.config.connectors.map((connector) =>
          isObject(connector) ? renameConnector(connector) : connector,
        ),
      },
    };
  };

  return {
    ...document,
    steps: (document.steps as unknown[]).map((step) => (isObject(step) ? renameStep(step) : step)),
  } as WorkflowDocumentInput;
}
