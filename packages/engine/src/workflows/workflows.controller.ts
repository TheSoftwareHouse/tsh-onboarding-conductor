import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AdminRoute } from '../auth/admin-route.decorator';
import { ApiErrorResponses, VALIDATION_ERROR } from '../openapi/api-error-responses.decorator';
import { API_TAGS, WORKFLOW_DOCUMENT_SCHEMA, schemaRef } from '../openapi/openapi.constants';
import { GetWorkflowQueryDto } from './dto/get-workflow.query.dto';
import { ListAdminWorkflowVersionsResponseDto } from './dto/list-admin-workflow-versions.response.dto';
import { ListAdminWorkflowsQueryDto } from './dto/list-admin-workflows.query.dto';
import { ListAdminWorkflowsResponseDto } from './dto/list-admin-workflows.response.dto';
import { WorkflowCompilationResponseDto } from './dto/workflow-compilation.response.dto';
import { WorkflowDefinitionResponseDto } from './dto/workflow-definition.response.dto';
import { WorkflowConnectorDeclarationInvalidException } from './errors/workflow-connector-declaration-invalid.exception';
import { WorkflowInvalidException } from './errors/workflow-invalid.exception';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRevisionNotFoundError } from './errors/workflow-revision-not-found.error';
import { WorkflowSourceKeyConflictException } from './errors/workflow-source-key-conflict.exception';
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

  @Get('/')
  @AdminRoute()
  @ApiOperation({
    operationId: 'listAdminWorkflows',
    summary: 'List workflows',
    description:
      'One page of workflow families the engine has loaded, narrowed by the filters. Counts are ' +
      'computed live; a draft version appears only once the database has been edited by hand, ' +
      'since the engine never writes that status itself.',
  })
  @ApiOkResponse({
    type: ListAdminWorkflowsResponseDto,
    description: 'One page of workflow summaries.',
  })
  @ApiErrorResponses(VALIDATION_ERROR)
  list(@Query() query: ListAdminWorkflowsQueryDto): Promise<ListAdminWorkflowsResponseDto> {
    return this.workflowRegistryService.listForAdmin(query);
  }

  @Get(':workflowId')
  @AdminRoute()
  @ApiOperation({
    operationId: 'getWorkflow',
    summary: 'Read a workflow definition',
    description:
      'The shape of a workflow as a reader needs it: steps, statuses, transitions, data fields, ' +
      "and each connector declaration's identity and field mapping. Connector config, retry and " +
      'error handling are not included. A pinned revision is served whatever its status, retired ' +
      'included; starting or submitting on a retired revision is still refused.',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The workflow id.',
    example: 'eu-b2c-individual-kyc-eea',
  })
  @ApiOkResponse({ type: WorkflowDefinitionResponseDto, description: 'The workflow definition.' })
  @ApiErrorResponses(VALIDATION_ERROR, WorkflowNotFoundException)
  async get(
    @Param('workflowId') workflowId: string,
    @Query() query: GetWorkflowQueryDto,
  ): Promise<WorkflowDefinitionResponseDto> {
    try {
      return await this.workflowRegistryService.describeForAdmin(workflowId, query.version);
    } catch (cause) {
      // A version with no stored revision is a 404 miss; any other invalid workflow stays a fault.
      throw cause instanceof WorkflowRevisionNotFoundError
        ? new WorkflowNotFoundException()
        : cause;
    }
  }

  @Get(':workflowId/versions')
  @AdminRoute()
  @ApiOperation({
    operationId: 'listAdminWorkflowVersions',
    summary: "List a workflow's versions",
    description:
      'Every stored version of the workflow, newest first, with its status. Unpaginated: a ' +
      'workflow holds a handful of versions and a version picker needs all of them.',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The workflow id.',
    example: 'eu-b2c-individual-kyc-eea',
  })
  @ApiOkResponse({
    type: ListAdminWorkflowVersionsResponseDto,
    description: 'The stored versions, highest first.',
  })
  @ApiErrorResponses(WorkflowNotFoundException)
  listVersions(
    @Param('workflowId') workflowId: string,
  ): Promise<ListAdminWorkflowVersionsResponseDto> {
    return this.workflowRegistryService.listVersionsForAdmin(workflowId);
  }
}
