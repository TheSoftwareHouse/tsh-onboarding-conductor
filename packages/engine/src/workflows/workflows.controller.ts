import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AzureJwtGuard } from '../auth/azure-jwt.guard';
import { GetWorkflowQueryDto } from './dto/get-workflow.query.dto';
import type { WorkflowCompilationResponse } from './dto/workflow-compilation.response.dto';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRevisionNotFoundError } from './errors/workflow-revision-not-found.error';
import type { WorkflowDefinitionResponse } from './dto/workflow-definition.response.dto';
import type { Workflow } from './domain/workflow';
import { RawWorkflowDocumentPipe } from './transport/raw-workflow-document.pipe';
import { WorkflowCompilationService } from './workflow-compilation.service';
import { WorkflowRegistryService } from './workflow-registry.service';

/**
 * Admin read surface for the workflow catalogue. Guarded like the other admin reads: a workflow
 * document states how a product's onboarding is decided, which is not public information.
 */
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
  @UseGuards(AzureJwtGuard)
  async compile(
    @Body(new RawWorkflowDocumentPipe()) document: unknown,
  ): Promise<WorkflowCompilationResponse> {
    return this.workflowCompilationService.compile(document);
  }

  @Get(':workflowId')
  @UseGuards(AzureJwtGuard)
  async get(
    @Param('workflowId') workflowId: string,
    @Query() query: GetWorkflowQueryDto,
  ): Promise<WorkflowDefinitionResponse> {
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
