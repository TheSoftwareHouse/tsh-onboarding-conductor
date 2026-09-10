import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRoute } from '../auth/admin-route.decorator';
import { API_TAGS } from '../openapi/openapi.constants';
import { NodeTypesListResponseDto } from './dto/workflow-compilation.response.dto';
import { WorkflowCompilationService } from './workflow-compilation.service';

/**
 * The node palette and its schema, for a builder. Guarded like the rest of the admin surface: the
 * config schemas name every provider setting a workflow may carry.
 */
@ApiTags(API_TAGS.adminNodeTypes.name)
@Controller('v1/admin/node-types')
export class NodeTypesController {
  constructor(private readonly workflowCompilationService: WorkflowCompilationService) {}

  @Get()
  @AdminRoute()
  @ApiOperation({
    operationId: 'listNodeTypes',
    summary: 'List node types',
    description:
      'Every node type a workflow graph may use, with its category, whether it composes into ' +
      'another node, the connector capabilities it accepts and the JSON Schema of its config. ' +
      'Ports are not listed: for several types they depend on the config.',
  })
  @ApiOkResponse({ type: NodeTypesListResponseDto, description: 'The node palette.' })
  list(): NodeTypesListResponseDto {
    return this.workflowCompilationService.listNodeTypes();
  }

  @Get('schema')
  @AdminRoute()
  @ApiOperation({
    operationId: 'getNodeGraphSchema',
    summary: 'Read the node-graph JSON Schema',
    description:
      'The JSON Schema a node-graph document must satisfy, exactly as the engine applies it. ' +
      'Derived in memory from the registered node types, field types and formats, so it reflects ' +
      'whatever this build has mounted.',
  })
  @ApiOkResponse({
    description: 'A JSON Schema document (draft-07).',
    schema: { type: 'object', additionalProperties: true },
  })
  schema(): Record<string, unknown> {
    return this.workflowCompilationService.getNodeGraphSchema();
  }
}
