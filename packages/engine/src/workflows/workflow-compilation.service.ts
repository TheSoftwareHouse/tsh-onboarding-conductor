import { Injectable } from '@nestjs/common';
import {
  compileWorkflowReport,
  getWorkflowJsonSchema,
  listStepTypes,
  WorkflowInvalidError,
} from '@tsh/ddl-schema';
import { Workflow } from './domain/workflow';
import type {
  StepTypesListResponseDto,
  WorkflowCompilationResponseDto,
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
 * load. A dry compile runs every check startup runs — the DDL, the step types, each adapter's own
 * declaration rules, source-key uniqueness against the store — and stores nothing, so an author
 * learns at edit time what would otherwise have failed a deploy.
 */
@Injectable()
export class WorkflowCompilationService {
  constructor(private readonly workflowRegistryService: WorkflowRegistryService) {}

  async compile(document: unknown): Promise<WorkflowCompilationResponseDto> {
    if (!isPlainObject(document)) {
      throw new WorkflowInvalidException('INVALID_SHAPE');
    }

    try {
      // The report is what a builder draws from; the registry re-reads the authored document
      // because its checks — the adapters', the source-key sweep — are stated over what startup
      // would be handed, and compiling a graph twice costs less than a second seam would.
      const report = compileWorkflowReport(document);
      const normalized = await this.workflowRegistryService.validateDefinition(document);

      return {
        definition: report.definition,
        steps: report.steps,
        workflow: new Workflow(normalized, undefined, normalized.name ?? null).describeDefinition(
          report.steps,
          this.workflowRegistryService.createConnectorSelectionRules(),
        ),
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
   * The palette. Ports are deliberately not listed here: for `decision`, `document-choice`,
   * `risk-score` and `connector-call` they depend on the config, so only a compile can say what
   * they are.
   */
  listStepTypes(): StepTypesListResponseDto {
    return {
      stepTypes: listStepTypes().map((stepType) => ({
        type: stepType.type,
        category: stepType.category,
        composable: stepType.composable === true,
        connectorTypes: [...(stepType.connectorSlot?.types ?? [])],
        configSchema: stepType.buildConfigSchema(),
      })),
    };
  }

  /** The workflow JSON Schema as the engine will apply it, for a builder that validates as it goes. */
  getWorkflowSchema(): Record<string, unknown> {
    return getWorkflowJsonSchema();
  }
}
