import { Controller, Get, UseGuards } from '@nestjs/common';
import { AzureJwtGuard } from '../auth/azure-jwt.guard';
import type { StepTypesListResponse } from './dto/workflow-compilation.response.dto';
import { WorkflowCompilationService } from './workflow-compilation.service';

/**
 * The step palette and its schema, for a builder. Guarded like the rest of the admin surface: the
 * config schemas name every provider setting a workflow may carry.
 */
@Controller('v1/admin/step-types')
export class StepTypesController {
  constructor(private readonly workflowCompilationService: WorkflowCompilationService) {}

  @Get()
  @UseGuards(AzureJwtGuard)
  list(): StepTypesListResponse {
    return this.workflowCompilationService.listStepTypes();
  }

  @Get('schema')
  @UseGuards(AzureJwtGuard)
  schema(): Record<string, unknown> {
    return this.workflowCompilationService.getWorkflowSchema();
  }
}
