import { Injectable } from '@nestjs/common';
import {
  compileNodeGraphReport,
  getNodeGraphJsonSchema,
  isNodeGraphDefinition,
  listNodeTypes,
  WorkflowInvalidError,
  type RawWorkflowDefinition,
} from '@tsh/ddl-schema';
import { Workflow } from './domain/workflow';
import type {
  NodeTypesListResponse,
  WorkflowCompilationResponse,
} from './dto/workflow-compilation.response.dto';
import { DuplicateWorkflowSourceKeyError } from './errors/duplicate-workflow-source-key.error';
import { WorkflowConnectorDeclarationInvalidError } from './errors/workflow-connector-declaration-invalid.error';
import { WorkflowConnectorDeclarationInvalidException } from './errors/workflow-connector-declaration-invalid.exception';
import { WorkflowInvalidException } from './errors/workflow-invalid.exception';
import { WorkflowSourceKeyConflictException } from './errors/workflow-source-key-conflict.exception';
import { WorkflowRegistryService } from './workflow-registry.service';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The builder's side of the workflow catalogue: what it may place, and whether what it drew would
 * load. A dry compile runs every check startup runs — the DDL, the node graph, each adapter's own
 * declaration rules, source-key uniqueness against the store — and stores nothing, so an author
 * learns at edit time what would otherwise have failed a deploy.
 */
@Injectable()
export class WorkflowCompilationService {
  constructor(private readonly workflowRegistryService: WorkflowRegistryService) {}

  async compile(document: unknown): Promise<WorkflowCompilationResponse> {
    if (!isPlainObject(document)) {
      throw new WorkflowInvalidException('INVALID_SHAPE');
    }

    try {
      const report = isNodeGraphDefinition(document) ? compileNodeGraphReport(document) : null;
      const definition = (report?.definition ?? document) as RawWorkflowDefinition;
      const normalized = await this.workflowRegistryService.validateDefinition(definition);

      return {
        definition,
        nodes: report?.nodes ?? null,
        workflow: new Workflow(normalized).describeDefinition(),
      };
    } catch (error) {
      // Each is an authoring defect the caller can fix; anything else is the engine's own failure.
      if (error instanceof WorkflowInvalidError) {
        throw new WorkflowInvalidException(error.reason, error.path);
      }

      if (error instanceof WorkflowConnectorDeclarationInvalidError) {
        throw new WorkflowConnectorDeclarationInvalidException(error.stepName, error.message);
      }

      if (error instanceof DuplicateWorkflowSourceKeyError) {
        throw new WorkflowSourceKeyConflictException(error.sourceKey, error.firstWorkflowId);
      }

      throw error;
    }
  }

  /**
   * The palette. Ports are deliberately not listed here: for `decision`, `document-choice` and
   * `risk-score` they depend on the config, so only a compile can say what they are.
   */
  listNodeTypes(): NodeTypesListResponse {
    return {
      nodeTypes: listNodeTypes().map((nodeType) => ({
        type: nodeType.type,
        category: nodeType.category,
        composable: nodeType.composable === true,
        configSchema: nodeType.buildConfigSchema(),
      })),
    };
  }

  /** The node-graph JSON Schema as the engine will apply it, for a builder that validates as it goes. */
  getNodeGraphSchema(): Record<string, unknown> {
    return getNodeGraphJsonSchema();
  }
}
