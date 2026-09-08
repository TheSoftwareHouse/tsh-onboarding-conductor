import type {
  ConnectorType,
  JsonSchemaFragment,
  NodeReport,
  RawWorkflowDefinition,
} from '@tsh/ddl-schema';
import type { WorkflowDefinitionResponse } from './workflow-definition.response.dto';

/**
 * What a dry compile hands back. Everything startup would have checked has passed — the schema,
 * the node graph, connector declarations, source-key uniqueness against the store — so a builder
 * saving this document afterwards knows the engine will load it.
 */
export type WorkflowCompilationResponse = {
  /** The step form the engine runs: the document itself, or what its node graph compiled to. */
  definition: RawWorkflowDefinition;
  /** Each node's steps and where its ports lead, for a node graph; null for a hand-written document. */
  nodes: readonly NodeReport[] | null;
  /** The same read-side projection `GET /v1/admin/workflows/:id` serves for a stored revision. */
  workflow: WorkflowDefinitionResponse;
};

/** One entry of the palette a builder offers. Ports are omitted: for several types they depend on config. */
export type NodeTypeResponse = {
  type: string;
  category: string;
  /** Whether it may be merged into another node's step through `include`. */
  composable: boolean;
  /**
   * The connector capabilities the node's slot accepts — what a builder filters the configured
   * connectors by when the author picks one. Empty for a node that calls no connector.
   */
  connectorTypes: readonly ConnectorType[];
  /** JSON Schema for the node's `config`, which is what a builder renders a form from. */
  configSchema: JsonSchemaFragment;
};

export type NodeTypesListResponse = {
  nodeTypes: NodeTypeResponse[];
};
