import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AdminRoute } from '../auth/admin-route.decorator';
import { ApiErrorResponses, VALIDATION_ERROR } from '../openapi/api-error-responses.decorator';
import { API_TAGS, WORKFLOW_DOCUMENT_SCHEMA, schemaRef } from '../openapi/openapi.constants';
import { GetWorkflowQueryDto } from './dto/get-workflow.query.dto';
import { WorkflowCompilationResponseDto } from './dto/workflow-compilation.response.dto';
import { WorkflowDefinitionResponseDto } from './dto/workflow-definition.response.dto';
import { WorkflowConnectorDeclarationInvalidException } from './errors/workflow-connector-declaration-invalid.exception';
import { WorkflowInvalidException } from './errors/workflow-invalid.exception';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRetiredException } from './errors/workflow-retired.exception';
import { WorkflowRevisionNotFoundError } from './errors/workflow-revision-not-found.error';
import { WorkflowSourceKeyConflictException } from './errors/workflow-source-key-conflict.exception';
import type { Workflow } from './domain/workflow';
import { RawWorkflowDocumentPipe } from './transport/raw-workflow-document.pipe';
import { WorkflowCompilationService } from './workflow-compilation.service';
import { WorkflowRegistryService } from './workflow-registry.service';

/**
 * Admin read surface for the workflow catalogue. Guarded like the other admin reads: a workflow
 * document states how a product's onboarding is decided, which is not public information.
 */
@ApiTags(API_TAGS.adminWorkflows.name)
@Controller('v1/admin/workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowRegistryService: WorkflowRegistryService,
    private readonly workflowCompilationService: WorkflowCompilationService,
  ) {}

  /**
   * A dry run of what startup does to a document, storing nothing. `200` rather than `201`: nothing
   * is created, and the body is a report rather than a resource.
   */
  @Post('compile')
  @HttpCode(200)
  @AdminRoute()
  @ApiOperation({
    operationId: 'compileWorkflow',
    summary: 'Compile a workflow document (dry run)',
    description:
      'Runs every check startup would run on the document, storing nothing: the schema, the step ' +
      'types, connector declarations, and source-key uniqueness against the store. `200` rather ' +
      'than `201` because nothing is created; the body is a report. A document that passes here ' +
      'will load.',
  })
  @ApiBody({
    description:
      'A workflow document in its authored form: a list of typed `steps`. The body is passed to ' +
      'the DDL untouched, so an unknown property is reported by it rather than silently dropped.',
    schema: { $ref: schemaRef(WORKFLOW_DOCUMENT_SCHEMA) },
  })
  @ApiOkResponse({
    type: WorkflowCompilationResponseDto,
    description:
      'The document passed every check; the compiled form, the step report and the read-side ' +
      'projection.',
  })
  @ApiErrorResponses(
    WorkflowInvalidException,
    WorkflowConnectorDeclarationInvalidException,
    WorkflowSourceKeyConflictException,
  )
  async compile(
    @Body(new RawWorkflowDocumentPipe()) document: unknown,
  ): Promise<WorkflowCompilationResponseDto> {
    return this.workflowCompilationService.compile(document);
  }

  @Get(':workflowId')
  @AdminRoute()
  @ApiOperation({
    operationId: 'getWorkflow',
    summary: 'Read a workflow definition',
    description:
      'The shape of a workflow as a reader needs it: steps, statuses and transitions. Step data ' +
      'fields and connector declarations are left out; the former are served per step by the state ' +
      'route, the latter carry provider configuration.',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The workflow id.',
    example: 'eu-b2c-individual-kyc-eea',
  })
  @ApiOkResponse({ type: WorkflowDefinitionResponseDto, description: 'The workflow definition.' })
  @ApiErrorResponses(VALIDATION_ERROR, WorkflowNotFoundException, WorkflowRetiredException)
  async get(
    @Param('workflowId') workflowId: string,
    @Query() query: GetWorkflowQueryDto,
  ): Promise<WorkflowDefinitionResponseDto> {
    const workflow = await this.resolve(workflowId, query.version);

    return workflow.describeDefinition();
  }

  /**
   * The registry owns revision resolution, including which statuses a pinned lookup may reach; the
   * one thing it does not owe an HTTP caller is a status code. A version it holds no revision of is
   * reported as an invalid workflow, which is not an HTTP error and would surface as a 500 — from a
   * reader's side that is a miss like any other, so it is answered as one. Every other way a
   * workflow can be invalid means a stored definition stopped validating, which really is a fault
   * and is left to read as one.
   */
  private async resolve(workflowId: string, version: number | undefined): Promise<Workflow> {
    try {
      return await this.workflowRegistryService.getById(workflowId, version);
    } catch (cause) {
      if (cause instanceof WorkflowRevisionNotFoundError) {
        throw new WorkflowNotFoundException();
      }

      throw cause;
    }
  }
}
