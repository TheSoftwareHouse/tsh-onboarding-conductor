import { ApiProperty } from '@nestjs/swagger';
import {
  type ConnectorRejectionReason,
  type NormalizedWorkflowCondition,
  type NormalizedWorkflowScore,
  type WorkflowStatus,
} from '@tsh/ddl-schema';
import { WORKFLOW_STATUS_ENUM, CONNECTOR_REJECTION_REASON_ENUM } from '../../openapi/api-enums';
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

export class WorkflowStepResponseDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({ ...WORKFLOW_STATUS_ENUM })
  status!: WorkflowStatus;

  @ApiProperty({ description: 'True for a step the onboarding ends in.' })
  terminal!: boolean;

  @ApiProperty({ type: () => WorkflowTransitionResponseDto, isArray: true })
  transitions!: WorkflowTransitionResponseDto[];
}

/**
 * The shape of a workflow, without anything about how it is carried out.
 *
 * Deliberately excludes each step's `data` fields and `connectors`: connector declarations carry
 * provider configuration, which has no place in a browser, and the field list is already served
 * per step by the state endpoint to the client that has to render it.
 */
export class WorkflowDefinitionResponseDto {
  @ApiProperty()
  workflowId!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  workflowVersion!: number;

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

  @ApiProperty({ type: () => WorkflowStepResponseDto, isArray: true })
  steps!: WorkflowStepResponseDto[];
}
