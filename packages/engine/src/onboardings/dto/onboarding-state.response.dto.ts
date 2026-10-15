import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  type ConnectorRejectionReason,
  type JsonSchemaFragment,
  type NormalizedWorkflowCondition,
  type WorkflowStatus,
} from '@tsh/ddl-schema';
import { WORKFLOW_STATUS_ENUM, CONNECTOR_REJECTION_REASON_ENUM } from '../../openapi/api-enums';
import {
  JSON_VALUE_SCHEMA,
  WORKFLOW_CONDITION_SCHEMA,
  schemaRef,
} from '../../openapi/openapi.constants';

/**
 * These classes mirror `StepDescription` in `workflows/domain/step.ts`, which stays a plain type
 * because domain code carries no framework decorators; the service returns the domain object and
 * TypeScript checks it against this shape structurally.
 */
export class StepFieldUploadDescriptionResponseDto {
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

export class StepFieldDescriptionResponseDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({
    description: 'The field type, as registered in the field-type registry (`text`, `file`, ...).',
  })
  type!: string;

  @ApiProperty()
  required!: boolean;

  @ApiProperty({
    description:
      'Whether the field applies given the data persisted so far. `when` lets a client ' +
      're-resolve this as the form fills.',
  })
  active!: boolean;

  @ApiProperty({
    type: [String],
    description: "Fields whose values this field's `when` condition reads.",
  })
  dependsOn!: readonly string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: "JSON Schema for this field's value.",
  })
  schema!: JsonSchemaFragment;

  @ApiProperty({
    allOf: [{ $ref: schemaRef(JSON_VALUE_SCHEMA) }],
    description:
      'Persisted value for prefill, or null when the step has not accepted the field yet.',
  })
  value!: unknown;

  @ApiPropertyOptional({
    allOf: [{ $ref: schemaRef(WORKFLOW_CONDITION_SCHEMA) }],
    description: 'The condition that decides `active`; absent for a field that always applies.',
  })
  when?: NormalizedWorkflowCondition;

  @ApiPropertyOptional({
    type: () => StepFieldUploadDescriptionResponseDto,
    description: 'Present for an upload field: what the document upload routes will accept for it.',
  })
  upload?: StepFieldUploadDescriptionResponseDto;
}

export class StepDescriptionResponseDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({ ...WORKFLOW_STATUS_ENUM })
  status!: WorkflowStatus;

  @ApiProperty({
    description: 'Whether the step declares a success transition, so a submit can ever be applied.',
  })
  canSubmit!: boolean;

  @ApiProperty({ type: () => StepFieldDescriptionResponseDto, isArray: true })
  fields!: readonly StepFieldDescriptionResponseDto[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'JSON Schema of the submit body for the currently active fields; identical to what submit ' +
      'enforces.',
  })
  schema!: JsonSchemaFragment;
}

/** The connector a parked onboarding waits on; the provider's own reference stays server-side. */
export class OnboardingStatePendingResponseDto {
  @ApiProperty({ description: 'The id of the connector the onboarding is waiting on.' })
  connectorId!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the onboarding was first parked on this connector; null for a row parked before ' +
      'the engine recorded it.',
  })
  parkedAt!: string | null;
}

/** Everything a client needs to render the current step and to know when there is none left. */
export class OnboardingStateResponseDto {
  @ApiProperty({ format: 'uuid' })
  onboardingId!: string;

  @ApiProperty()
  workflowId!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  workflowVersion!: number;

  @ApiProperty({ ...WORKFLOW_STATUS_ENUM })
  status!: WorkflowStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The step awaiting data; null once the onboarding is terminal.',
  })
  currentStep!: string | null;

  @ApiProperty({
    description: 'True once the onboarding sits in a terminal step; `step` is then null.',
  })
  terminal!: boolean;

  @ApiProperty({
    ...CONNECTOR_REJECTION_REASON_ENUM,
    nullable: true,
    description:
      'Why a connector refused, when a rejection a connector drove ended the onboarding.',
  })
  rejectionReason!: ConnectorRejectionReason | null;

  @ApiProperty({
    type: () => StepDescriptionResponseDto,
    nullable: true,
    description: 'The step to render, resolved against the persisted data; null when terminal.',
  })
  step!: StepDescriptionResponseDto | null;

  @ApiProperty({
    type: () => OnboardingStatePendingResponseDto,
    nullable: true,
    description:
      'The connector the onboarding is parked on awaiting a provider callback, so a client can ' +
      'show it as processing; null when it is not waiting for one.',
  })
  pending!: OnboardingStatePendingResponseDto | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { allOf: [{ $ref: schemaRef(JSON_VALUE_SCHEMA) }] },
    description:
      'The current value of every field a step marked client-visible, for every step already ' +
      'passed, keyed by field name. Nothing else the onboarding collected appears here.',
  })
  data!: Record<string, unknown>;
}
