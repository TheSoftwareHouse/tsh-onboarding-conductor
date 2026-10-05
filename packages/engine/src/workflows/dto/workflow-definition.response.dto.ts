import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  type ConnectorRejectionReason,
  type ConnectorType,
  type JsonSchemaFragment,
  type NormalizedWorkflowCondition,
  type NormalizedWorkflowScore,
  type WorkflowStatus,
} from '@tsh/ddl-schema';
import {
  CONNECTOR_REJECTION_REASON_ENUM,
  CONNECTOR_TYPE_ENUM,
  WORKFLOW_STATUS_ENUM,
} from '../../openapi/api-enums';
import { WORKFLOW_CONDITION_SCHEMA, schemaRef } from '../../openapi/openapi.constants';

/** One transition a step declares, as the admin read surface exposes it. */
export class WorkflowTransitionResponseDto {
  @ApiProperty({
    description:
      'The transition status this arm handles, such as `success`, `rejected` or `manual.approve`.',
  })
  status!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Step this transition moves to, or null for a transition that re-enters its own step.',
  })
  target!: string | null;

  @ApiProperty({
    allOf: [{ $ref: schemaRef(WORKFLOW_CONDITION_SCHEMA) }],
    nullable: true,
    description: 'Condition guarding the transition, or null when it always applies.',
  })
  when!: NormalizedWorkflowCondition | null;

  @ApiProperty({
    ...CONNECTOR_REJECTION_REASON_ENUM,
    isArray: true,
    nullable: true,
    description:
      'Refusal reasons this arm claims, or null when it claims any. Without it two `rejected` arms ' +
      'to different targets are indistinguishable to a reader.',
  })
  reason!: readonly ConnectorRejectionReason[] | null;
}

/** The authored step a compiled step came from; absent for a document with no report. */
export class WorkflowStepSourceResponseDto {
  @ApiProperty({ description: 'The authored step name.' })
  step!: string;

  @ApiProperty({ description: 'The authored step type, such as `otp-verify` or `custom`.' })
  type!: string;

  @ApiProperty({ description: 'The step type category, such as `collect` or `terminal`.' })
  category!: string;
}

export class WorkflowFieldUploadResponseDto {
  @ApiProperty({ type: [String], description: 'MIME types the field accepts.' })
  contentTypes!: readonly string[];

  @ApiProperty({ type: 'integer' })
  maxSizeBytes!: number;

  @ApiPropertyOptional({
    type: 'integer',
    description: 'Present for image fields that bound width.',
  })
  maxImageWidth?: number;

  @ApiPropertyOptional({
    type: 'integer',
    description: 'Present for image fields that bound height.',
  })
  maxImageHeight?: number;
}

/** One field a step declares, without any onboarding's value. */
export class WorkflowFieldResponseDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'The field type name, such as `text`, `file` or `boolean`.' })
  type!: string;

  @ApiProperty()
  required!: boolean;

  @ApiProperty({ description: 'False when the accepted value is validated but not stored.' })
  persist!: boolean;

  @ApiProperty({
    allOf: [{ $ref: schemaRef(WORKFLOW_CONDITION_SCHEMA) }],
    nullable: true,
    description: 'Condition that makes the field apply, or null when it always does.',
  })
  when!: NormalizedWorkflowCondition | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: "JSON Schema for this field's value, as the state endpoint serves it.",
  })
  schema!: JsonSchemaFragment;

  @ApiProperty({
    type: () => WorkflowFieldUploadResponseDto,
    nullable: true,
    description: 'What the document upload routes accept for an upload field, otherwise null.',
  })
  upload!: WorkflowFieldUploadResponseDto | null;
}

/** A connector declaration's identity and field mapping. Its `config`, `retry` and `errorHandler` are never exposed. */
export class WorkflowStepConnectorResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ ...CONNECTOR_TYPE_ENUM })
  type!: ConnectorType;

  @ApiProperty({ type: 'integer', description: 'Position among the step connectors.' })
  order!: number;

  @ApiProperty({ description: 'Whether the connector may refuse the step.' })
  canReject!: boolean;

  @ApiProperty({ description: 'Whether the connector resolves asynchronously.' })
  async!: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Required connector inputs, mapped to the context field that fills each.',
  })
  fieldMapping!: Readonly<Record<string, string>>;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Optional connector inputs, mapped to the context field that fills each.',
  })
  optionalFieldMapping!: Readonly<Record<string, string>>;
}

export class WorkflowStepConnectorWithFallbacksResponseDto extends WorkflowStepConnectorResponseDto {
  @ApiProperty({
    description:
      'The connector id the workflow document authored. Differs from `id` while an operator ' +
      'selection is in force.',
    example: 'sumsub_kyc',
  })
  authoredId!: string;

  @ApiProperty({
    description:
      'True when an operator selection replaces the authored connector on this step, in every ' +
      'stored version of the workflow that has the step.',
  })
  selected!: boolean;

  @ApiProperty({
    type: String,
    isArray: true,
    description:
      'The connector ids an operator may choose for this step, sorted: the authored and ' +
      'effective ids plus every registered connector of the same type, callback-capable when ' +
      'the step is asynchronous.',
    example: ['sumsub_kyc', 'veriff_kyc'],
  })
  selectableIds!: string[];

  @ApiProperty({
    type: () => WorkflowStepConnectorResponseDto,
    isArray: true,
    description: 'The chain behind this connector, in declared order.',
  })
  fallbacks!: WorkflowStepConnectorResponseDto[];
}

export class WorkflowWebhookNotifyResponseDto {
  @ApiProperty({ description: 'Path the state-change webhook is delivered to.' })
  path!: string;
}

export class WorkflowWebhookResponseDto {
  @ApiProperty({ type: () => WorkflowWebhookNotifyResponseDto })
  notify!: WorkflowWebhookNotifyResponseDto;
}

export class WorkflowStepResponseDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({ ...WORKFLOW_STATUS_ENUM })
  status!: WorkflowStatus;

  @ApiProperty({ description: 'True for a step the onboarding ends in.' })
  terminal!: boolean;

  @ApiProperty({ type: () => WorkflowTransitionResponseDto, isArray: true })
  transitions!: WorkflowTransitionResponseDto[];

  @ApiProperty({
    type: () => WorkflowStepSourceResponseDto,
    nullable: true,
    description: 'The authored step this one compiled from, or null when no report was available.',
  })
  source!: WorkflowStepSourceResponseDto | null;

  @ApiProperty({ type: () => WorkflowFieldResponseDto, isArray: true })
  fields!: WorkflowFieldResponseDto[];

  @ApiProperty({ type: () => WorkflowStepConnectorWithFallbacksResponseDto, isArray: true })
  connectors!: WorkflowStepConnectorWithFallbacksResponseDto[];
}

/** A workflow's shape: steps, fields, connector identity and mapping, never connector config. */
export class WorkflowDefinitionResponseDto {
  @ApiProperty()
  workflowId!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  workflowVersion!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The display label the workflow is known by: for a stored workflow, the root `name` its ' +
      'highest stored version declares; for a compiled document, its own. Null when none does.',
    example: 'EU B2C individual KYC — EEA, applicant chooses the document',
  })
  name!: string | null;

  @ApiProperty({ description: 'The step every onboarding of this workflow starts on.' })
  initialStep!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'object',
      required: ['name', 'min', 'max'],
      properties: {
        name: { type: 'string' },
        min: { type: 'number' },
        max: { type: 'number' },
      },
    },
    description:
      'Every score the workflow declares, keyed by score name, with the bounds it is clamped to.',
  })
  scores!: Readonly<Record<string, NormalizedWorkflowScore>>;

  @ApiProperty({
    type: () => WorkflowWebhookResponseDto,
    nullable: true,
    description: 'The state-change webhook the workflow declares, or null when it declares none.',
  })
  webhook!: WorkflowWebhookResponseDto | null;

  @ApiProperty({ type: () => WorkflowStepResponseDto, isArray: true })
  steps!: WorkflowStepResponseDto[];
}
