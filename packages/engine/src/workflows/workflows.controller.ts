import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AdminRoute } from '../auth/admin-route.decorator';
import { resolveOperatorId, type AdminAuthenticatedRequest } from '../auth/azure-jwt.guard';
import { ApiErrorResponses, VALIDATION_ERROR } from '../openapi/api-error-responses.decorator';
import { API_TAGS, WORKFLOW_DOCUMENT_SCHEMA, schemaRef } from '../openapi/openapi.constants';
import { AdminWorkflowDraftDocumentResponseDto } from './dto/admin-workflow-draft-document.response.dto';
import { AdminWorkflowDraftResponseDto } from './dto/admin-workflow-draft.response.dto';
import { ListAdminWorkflowVersionsResponseDto } from './dto/list-admin-workflow-versions.response.dto';
import { ListAdminWorkflowsQueryDto } from './dto/list-admin-workflows.query.dto';
import { ListAdminWorkflowsResponseDto } from './dto/list-admin-workflows.response.dto';
import { SelectWorkflowConnectorRequestDto } from './dto/select-workflow-connector.request.dto';
import { WorkflowCompilationResponseDto } from './dto/workflow-compilation.response.dto';
import {
  WorkflowDefinitionResponseDto,
  WorkflowStepConnectorWithFallbacksResponseDto,
} from './dto/workflow-definition.response.dto';
import { WorkflowVersionParamsDto } from './dto/workflow-version.params.dto';
import { WorkflowConnectorDeclarationInvalidException } from './errors/workflow-connector-declaration-invalid.exception';
import { WorkflowConnectorSelectionInvalidException } from './errors/workflow-connector-selection-invalid.exception';
import { WorkflowDraftExistsException } from './errors/workflow-draft-exists.exception';
import { WorkflowDraftInUseException } from './errors/workflow-draft-in-use.exception';
import { WorkflowInvalidException } from './errors/workflow-invalid.exception';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRevisionNotFoundError } from './errors/workflow-revision-not-found.error';
import { WorkflowScopeConflictException } from './errors/workflow-scope-conflict.exception';
import { WorkflowSourceKeyConflictException } from './errors/workflow-source-key-conflict.exception';
import { WorkflowStepNotFoundException } from './errors/workflow-step-not-found.exception';
import { WorkflowVersionExistsException } from './errors/workflow-version-exists.exception';
import { WorkflowVersionNotDraftException } from './errors/workflow-version-not-draft.exception';
import { RawWorkflowDocumentPipe } from './transport/raw-workflow-document.pipe';
import { WorkflowCompilationService } from './workflow-compilation.service';
import { WorkflowConnectorSelectionService } from './workflow-connector-selection.service';
import { WorkflowDraftsService } from './workflow-drafts.service';
import { WorkflowRegistryService } from './workflow-registry.service';

const DOCUMENT_BODY = {
  description:
    'A workflow document in its authored form. Only `id` and `version` are required to save; the ' +
    'rest is stored as sent and checked by the compile route, not here.',
  schema: { $ref: schemaRef(WORKFLOW_DOCUMENT_SCHEMA) },
};

const WORKFLOW_ID_PARAM = {
  name: 'workflowId',
  description: 'The workflow id.',
  example: 'my-onboarding',
};

const VERSION_PARAM = {
  name: 'version',
  type: 'integer',
  description: 'The revision number, a positive integer.',
  example: 1,
};

/**
 * Admin surface for the workflow catalogue: the reads, the compile dry run and the draft writes
 * (decision record 0034). Guarded like the other admin routes: a workflow document states how a
 * product's onboarding is decided, which is not public information.
 */
@ApiTags(API_TAGS.adminWorkflows.name)
@Controller('v1/admin/workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowRegistryService: WorkflowRegistryService,
    private readonly workflowCompilationService: WorkflowCompilationService,
    private readonly workflowDraftsService: WorkflowDraftsService,
    private readonly workflowConnectorSelectionService: WorkflowConnectorSelectionService,
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

  @Post('/')
  @AdminRoute()
  @ApiOperation({
    operationId: 'createWorkflowDraft',
    summary: 'Create a workflow draft',
    description:
      'Stores the document as a draft in the family its `id` names, creating the family in the ' +
      '`users` scope when it is new; a `name` of 1 to 200 characters labels a family this call ' +
      'creates. The document is not compiled, so a draft may be saved while still invalid. A ' +
      'family holds at most one draft, and a draft never starts an onboarding.',
  })
  @ApiBody(DOCUMENT_BODY)
  @ApiCreatedResponse({
    type: AdminWorkflowDraftResponseDto,
    description: 'The stored draft, without its document.',
  })
  @ApiErrorResponses(
    WorkflowInvalidException,
    WorkflowVersionExistsException,
    WorkflowDraftExistsException,
    WorkflowScopeConflictException,
  )
  create(
    @Body(new RawWorkflowDocumentPipe()) document: unknown,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<AdminWorkflowDraftResponseDto> {
    return this.workflowDraftsService.create(document, resolveOperatorId(request.adminTokenClaims));
  }

  @Get('/')
  @AdminRoute()
  @ApiOperation({
    operationId: 'listAdminWorkflows',
    summary: 'List workflows',
    description:
      'One page of workflow families the engine has loaded, narrowed by the filters. Counts are ' +
      'computed live, and a family holding a draft counts it.',
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
      'error handling are not included. This serves the highest published version; a pinned ' +
      'version is read from `/versions/{version}`.',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The workflow id.',
    example: 'eu-b2c-individual-kyc-eea',
  })
  @ApiOkResponse({ type: WorkflowDefinitionResponseDto, description: 'The workflow definition.' })
  @ApiErrorResponses(WorkflowNotFoundException)
  get(@Param('workflowId') workflowId: string): Promise<WorkflowDefinitionResponseDto> {
    return this.workflowRegistryService.describeForAdmin(workflowId);
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

  @Get(':workflowId/versions/:version')
  @AdminRoute()
  @ApiOperation({
    operationId: 'getWorkflowVersion',
    summary: 'Read one version of a workflow definition',
    description:
      'The same projection as the unpinned read, for the pinned revision whatever its status, ' +
      'draft and retired included; starting or submitting on a retired revision is still ' +
      'refused. A draft that does not compile answers `400` with the reason and, when known, ' +
      'the path.',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The workflow id.',
    example: 'eu-b2c-individual-kyc-eea',
  })
  @ApiParam({
    name: 'version',
    type: 'integer',
    description: 'The revision number, a positive integer.',
    example: 1,
  })
  @ApiOkResponse({ type: WorkflowDefinitionResponseDto, description: 'The workflow definition.' })
  @ApiErrorResponses(
    VALIDATION_ERROR,
    WorkflowInvalidException,
    WorkflowConnectorDeclarationInvalidException,
    WorkflowNotFoundException,
  )
  async getVersion(
    @Param() { workflowId, version }: WorkflowVersionParamsDto,
  ): Promise<WorkflowDefinitionResponseDto> {
    try {
      return await this.workflowRegistryService.describeForAdmin(workflowId, version);
    } catch (cause) {
      // A version with no stored revision is a 404 miss; any other invalid workflow stays a fault.
      throw cause instanceof WorkflowRevisionNotFoundError
        ? new WorkflowNotFoundException()
        : cause;
    }
  }

  @Get(':workflowId/versions/:version/document')
  @AdminRoute()
  @ApiOperation({
    operationId: 'getWorkflowDraftDocument',
    summary: "Read a draft's document",
    description:
      'The stored document of a draft, verbatim. Published and retired revisions answer ' +
      '`409 WORKFLOW_VERSION_NOT_DRAFT` without any document: only drafts, which an admin typed ' +
      'through this API, are served raw.',
  })
  @ApiParam(WORKFLOW_ID_PARAM)
  @ApiParam(VERSION_PARAM)
  @ApiOkResponse({
    type: AdminWorkflowDraftDocumentResponseDto,
    description: 'The draft and its document.',
  })
  @ApiErrorResponses(VALIDATION_ERROR, WorkflowNotFoundException, WorkflowVersionNotDraftException)
  getDocument(
    @Param() { workflowId, version }: WorkflowVersionParamsDto,
  ): Promise<AdminWorkflowDraftDocumentResponseDto> {
    return this.workflowDraftsService.getDocument(workflowId, version);
  }

  @Put(':workflowId/versions/:version')
  @AdminRoute()
  @ApiOperation({
    operationId: 'updateWorkflowDraft',
    summary: 'Replace a draft',
    description:
      'Replaces the draft with the document, which may carry a new `id` and `version` when that ' +
      'target is free: it must not name an existing revision in any status, a second draft, or a ' +
      'family outside the `users` scope. A family left with no versions is deleted. A draft an ' +
      'onboarding references cannot be replaced. The label is written only when the call creates ' +
      'the target family.',
  })
  @ApiParam(WORKFLOW_ID_PARAM)
  @ApiParam(VERSION_PARAM)
  @ApiBody(DOCUMENT_BODY)
  @ApiOkResponse({
    type: AdminWorkflowDraftResponseDto,
    description: 'The stored draft, without its document.',
  })
  @ApiErrorResponses(
    VALIDATION_ERROR,
    WorkflowInvalidException,
    WorkflowNotFoundException,
    WorkflowVersionNotDraftException,
    WorkflowDraftInUseException,
    WorkflowVersionExistsException,
    WorkflowDraftExistsException,
    WorkflowScopeConflictException,
  )
  update(
    @Param() { workflowId, version }: WorkflowVersionParamsDto,
    @Body(new RawWorkflowDocumentPipe()) document: unknown,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<AdminWorkflowDraftResponseDto> {
    return this.workflowDraftsService.update(
      workflowId,
      version,
      document,
      resolveOperatorId(request.adminTokenClaims),
    );
  }

  @Delete(':workflowId/versions/:version')
  @HttpCode(204)
  @AdminRoute()
  @ApiOperation({
    operationId: 'deleteWorkflowDraft',
    summary: 'Delete a draft',
    description:
      "Removes the draft, and its family when that was the family's last version. Published and " +
      'retired revisions are immutable, and a draft an onboarding references cannot be deleted.',
  })
  @ApiParam(WORKFLOW_ID_PARAM)
  @ApiParam(VERSION_PARAM)
  @ApiNoContentResponse({ description: 'The draft was deleted.' })
  @ApiErrorResponses(
    VALIDATION_ERROR,
    WorkflowNotFoundException,
    WorkflowVersionNotDraftException,
    WorkflowDraftInUseException,
  )
  remove(
    @Param() { workflowId, version }: WorkflowVersionParamsDto,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<void> {
    return this.workflowDraftsService.remove(
      workflowId,
      version,
      resolveOperatorId(request.adminTokenClaims),
    );
  }

  @Put(':workflowId/steps/:stepName/connector')
  @AdminRoute()
  @ApiOperation({
    operationId: 'selectWorkflowStepConnector',
    summary: "Bind a step's connector slot to another adapter",
    description:
      "Replaces the authored primary connector's id on every stored version of the family that " +
      'declares the step; config, field mapping, retry and fallbacks are untouched. The adapter ' +
      'is validated against each non-retired version, and the first to refuse it names itself in ' +
      '`workflowVersion`. Onboardings already parked on the step finish with the provider they ' +
      'started on. The response projects the slot from the highest published version. The write ' +
      'is audited under the operator the token identifies.',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The workflow id.',
    example: 'eu-b2c-individual-kyc-eea',
  })
  @ApiParam({
    name: 'stepName',
    description: 'The step whose connector slot is bound.',
    example: 'submit_kyc',
  })
  @ApiOkResponse({
    type: WorkflowStepConnectorWithFallbacksResponseDto,
    description: 'The step connector slot after the write, with its authored and selectable ids.',
  })
  @ApiErrorResponses(
    VALIDATION_ERROR,
    WorkflowNotFoundException,
    WorkflowStepNotFoundException,
    WorkflowConnectorSelectionInvalidException,
  )
  selectStepConnector(
    @Param('workflowId') workflowId: string,
    @Param('stepName') stepName: string,
    @Body() dto: SelectWorkflowConnectorRequestDto,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<WorkflowStepConnectorWithFallbacksResponseDto> {
    return this.workflowConnectorSelectionService.select(
      workflowId,
      stepName,
      dto.connectorId,
      resolveOperatorId(request.adminTokenClaims),
    );
  }

  @Delete(':workflowId/steps/:stepName/connector')
  @HttpCode(204)
  @AdminRoute()
  @ApiOperation({
    operationId: 'clearWorkflowStepConnector',
    summary: "Return a step's connector slot to its authored adapter",
    description:
      'Drops the stored binding, so every version of the family runs the connector its document ' +
      'authored. Clearing a step with no binding succeeds. The write is audited under the ' +
      'operator the token identifies.',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The workflow id.',
    example: 'eu-b2c-individual-kyc-eea',
  })
  @ApiParam({
    name: 'stepName',
    description: 'The step whose binding is cleared.',
    example: 'submit_kyc',
  })
  @ApiNoContentResponse({ description: 'The step runs its authored connector.' })
  @ApiErrorResponses(WorkflowNotFoundException)
  async clearStepConnector(
    @Param('workflowId') workflowId: string,
    @Param('stepName') stepName: string,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<void> {
    await this.workflowConnectorSelectionService.clear(
      workflowId,
      stepName,
      resolveOperatorId(request.adminTokenClaims),
    );
  }
}
