import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  type ConnectorType,
  type JsonSchemaFragment,
  type NodeReport,
  type RawWorkflowCondition,
  type RawWorkflowDefinition,
} from '@tsh/ddl-schema';
import { CONNECTOR_TYPE_ENUM } from '../../openapi/api-enums';
import { WORKFLOW_DOCUMENT_SCHEMA, schemaRef } from '../../openapi/openapi.constants';
import { WorkflowDefinitionResponseDto } from './workflow-definition.response.dto';

export class NodePortArmResponseDto {
  @ApiPropertyOptional({
    allOf: [{ $ref: schemaRef(`${WORKFLOW_DOCUMENT_SCHEMA}_condition`) }],
    description: 'Condition under which this arm is taken; absent for the unconditional arm.',
  })
  when?: RawWorkflowCondition;

  @ApiProperty({ description: 'The step the arm leads to.' })
  target!: string;
}

export class NodePortReportResponseDto {
  @ApiProperty({ description: 'The port name, as the node type declares it.' })
  name!: string;

  @ApiProperty({ type: () => NodePortArmResponseDto, isArray: true })
  arms!: readonly NodePortArmResponseDto[];
}

/** What one node of a graph compiled to. */
export class NodeReportResponseDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'The node type.' })
  type!: string;

  @ApiProperty()
  category!: string;

  @ApiProperty({ type: [String], description: 'The steps the node produced, in order.' })
  stepNames!: readonly string[];

  @ApiProperty({ type: () => NodePortReportResponseDto, isArray: true })
  ports!: readonly NodePortReportResponseDto[];
}

/**
 * What a dry compile hands back. Everything startup would have checked has passed — the schema,
 * the node graph, connector declarations, source-key uniqueness against the store — so a builder
 * saving this document afterwards knows the engine will load it.
 */
export class WorkflowCompilationResponseDto {
  @ApiProperty({
    allOf: [{ $ref: schemaRef(WORKFLOW_DOCUMENT_SCHEMA) }],
    description:
      'The step form the engine runs: the document itself, or what its node graph compiled to.',
  })
  definition!: RawWorkflowDefinition;

  @ApiProperty({
    type: () => NodeReportResponseDto,
    isArray: true,
    nullable: true,
    description:
      "Each node's steps and where its ports lead, for a node graph; null for a hand-written " +
      'document.',
  })
  nodes!: readonly NodeReport[] | null;

  @ApiProperty({
    type: () => WorkflowDefinitionResponseDto,
    description:
      'The same read-side projection the workflow read route serves for a stored revision.',
  })
  workflow!: WorkflowDefinitionResponseDto;
}

/** One entry of the palette a builder offers. Ports are omitted: for several types they depend on config. */
export class NodeTypeResponseDto {
  @ApiProperty({ example: 'otp-verify' })
  type!: string;

  @ApiProperty({ example: 'verification' })
  category!: string;

  @ApiProperty({
    description: "Whether it may be merged into another node's step through `include`.",
  })
  composable!: boolean;

  @ApiProperty({
    ...CONNECTOR_TYPE_ENUM,
    isArray: true,
    description:
      "The connector capabilities the node's slot accepts, which a builder filters the configured " +
      'connectors by when the author picks one. Empty for a node that calls no connector.',
  })
  connectorTypes!: readonly ConnectorType[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      "JSON Schema for the node's `config`, which is what a builder renders a form from.",
  })
  configSchema!: JsonSchemaFragment;
}

export class NodeTypesListResponseDto {
  @ApiProperty({ type: () => NodeTypeResponseDto, isArray: true })
  nodeTypes!: NodeTypeResponseDto[];
}
