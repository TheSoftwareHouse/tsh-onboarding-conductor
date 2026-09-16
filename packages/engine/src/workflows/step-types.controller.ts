import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRoute } from '../auth/admin-route.decorator';
import { API_TAGS } from '../openapi/openapi.constants';
import { StepTypesListResponseDto } from './dto/workflow-compilation.response.dto';
import { WorkflowCompilationService } from './workflow-compilation.service';

/**
 * The step palette and its schema, for a builder. Guarded like the rest of the admin surface: the
 * config schemas name every provider setting a workflow may carry.
 */
@ApiTags(API_TAGS.adminStepTypes.name)
@Controller('v1/admin/step-types')
export class StepTypesController {
  constructor(private readonly workflowCompilationService: WorkflowCompilationService) {}

  @Get()
  @AdminRoute()
  @ApiOperation({
    operationId: 'listStepTypes',
    summary: 'List step types',
    description:
      'Every step type a workflow may use, with its category, whether it composes into another ' +
      'step, the connector capabilities it accepts and the JSON Schema of its config. Ports are ' +
      'not listed: for several types they depend on the config.',
  })
  @ApiOkResponse({ type: StepTypesListResponseDto, description: 'The step palette.' })
  list(): StepTypesListResponseDto {
    return this.workflowCompilationService.listStepTypes();
  }

  @Get('schema')
  @AdminRoute()
  @ApiOperation({
    operationId: 'getWorkflowSchema',
    summary: 'Read the workflow JSON Schema',
    description:
      'The JSON Schema an authored workflow document must satisfy, exactly as the engine applies ' +
      'it. Derived in memory from the registered step types, field types and formats, so it ' +
      'reflects whatever this build has mounted.',
  })
  @ApiOkResponse({
    description: 'A JSON Schema document (draft-07).',
    schema: { type: 'object', additionalProperties: true },
  })
  schema(): Record<string, unknown> {
    return this.workflowCompilationService.getWorkflowSchema();
  }
}
