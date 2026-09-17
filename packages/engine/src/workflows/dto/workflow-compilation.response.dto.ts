import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  CompiledWorkflowDefinition,
  ConnectorType,
  JsonSchemaFragment,
  RawWorkflowCondition,
  StepReport,
} from '@tsh/ddl-schema';
import { CONNECTOR_TYPE_ENUM } from '../../openapi/api-enums';
import {
  COMPILED_WORKFLOW_DOCUMENT_SCHEMA,
  WORKFLOW_DOCUMENT_SCHEMA,
  schemaRef,
} from '../../openapi/openapi.constants';
import { WorkflowDefinitionResponseDto } from './workflow-definition.response.dto';

export class StepPortArmResponseDto {
  @ApiPropertyOptional({
    allOf: [{ $ref: schemaRef(`${WORKFLOW_DOCUMENT_SCHEMA}_condition`) }],
    description: 'Condition under which this arm is taken; absent for the unconditional arm.',
  })
  when?: RawWorkflowCondition;

  @ApiProperty({ description: 'The authored step the arm leads to.' })
  target!: string;
}

export class StepPortReportResponseDto {
  @ApiProperty({ description: 'The port name, as the step type declares it.' })
  name!: string;

  @ApiProperty({ type: () => StepPortArmResponseDto, isArray: true })
  arms!: readonly StepPortArmResponseDto[];
}

/** What one authored step compiled to. */
export class StepReportResponseDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'The step type.' })
  type!: string;

  @ApiProperty()
  category!: string;

  @ApiProperty({
    type: [String],
    description: 'The compiled steps the authored step produced, in order.',
  })
  compiledStepNames!: readonly string[];

  @ApiProperty({ type: () => StepPortReportResponseDto, isArray: true })
  ports!: readonly StepPortReportResponseDto[];
}

/**
 * What a dry compile hands back. Everything startup would have checked has passed — the schema,
 * the step types, connector declarations, source-key uniqueness against the store — so a builder
 * saving this document afterwards knows the engine will load it.
 */
export class WorkflowCompilationResponseDto {
  @ApiProperty({
    allOf: [{ $ref: schemaRef(COMPILED_WORKFLOW_DOCUMENT_SCHEMA) }],
    description: 'The compiled form the engine runs, which is what the typed steps compiled to.',
  })
  definition!: CompiledWorkflowDefinition;

  @ApiProperty({
    type: () => StepReportResponseDto,
    isArray: true,
    description: "Each authored step's compiled steps and where its ports lead.",
  })
  steps!: readonly StepReport[];

  @ApiProperty({
    type: () => WorkflowDefinitionResponseDto,
    description:
      'The same read-side projection the workflow read route serves for a stored revision.',
  })
  workflow!: WorkflowDefinitionResponseDto;
}

/** One entry of the palette a builder offers. Ports are omitted: for several types they depend on config. */
export class StepTypeResponseDto {
  @ApiProperty({ example: 'otp-verify' })
  type!: string;

  @ApiProperty({ example: 'verification' })
  category!: string;

  @ApiProperty({
    description: "Whether it may be merged into another step's compiled step through `include`.",
  })
  composable!: boolean;

  @ApiProperty({
    ...CONNECTOR_TYPE_ENUM,
    isArray: true,
    description:
      "The connector capabilities the step's slot accepts, which a builder filters the configured " +
      'connectors by when the author picks one. Empty for a step that calls no connector.',
  })
  connectorTypes!: readonly ConnectorType[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      "JSON Schema for the step's `config`, which is what a builder renders a form from.",
  })
  configSchema!: JsonSchemaFragment;
}

export class StepTypesListResponseDto {
  @ApiProperty({ type: () => StepTypeResponseDto, isArray: true })
  stepTypes!: StepTypeResponseDto[];
}
