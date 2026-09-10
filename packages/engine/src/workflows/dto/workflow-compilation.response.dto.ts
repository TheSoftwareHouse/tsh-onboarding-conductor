import type {
  ConnectorType,
  JsonSchemaFragment,
  StepReport,
  CompiledWorkflowDefinition,
} from '@tsh/ddl-schema';
import type { WorkflowDefinitionResponse } from './workflow-definition.response.dto';

/**
 * What a dry compile hands back. Everything startup would have checked has passed — the schema,
 * the step types, connector declarations, source-key uniqueness against the store — so a builder
 * saving this document afterwards knows the engine will load it.
 */
export type WorkflowCompilationResponse = {
  /** The compiled form the engine runs, which is what the typed steps compiled to. */
  definition: CompiledWorkflowDefinition;
  /** Each authored step's compiled steps and where its ports lead. */
  steps: readonly StepReport[];
  /** The same read-side projection `GET /v1/admin/workflows/:id` serves for a stored revision. */
  workflow: WorkflowDefinitionResponse;
};

/** One entry of the palette a builder offers. Ports are omitted: for several types they depend on config. */
export type StepTypeResponse = {
  type: string;
  category: string;
  /** Whether it may be merged into another step's step through `include`. */
  composable: boolean;
  /**
   * The connector capabilities the step's slot accepts — what a builder filters the configured
   * connectors by when the author picks one. Empty for a step that calls no connector.
   */
  connectorTypes: readonly ConnectorType[];
  /** JSON Schema for the step's `config`, which is what a builder renders a form from. */
  configSchema: JsonSchemaFragment;
};

export type StepTypesListResponse = {
  stepTypes: StepTypeResponse[];
};
