import { ApiProperty } from '@nestjs/swagger';

/** One audit row. `packages/engine/docs/audit-log-contract.md` documents the action names and metadata. */
export class AuditEventResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;

  @ApiProperty({
    description: 'Who acted: `system`, an operator, a webhook, or the process itself.',
    example: 'system',
  })
  actorType!: string;

  @ApiProperty({ description: 'The actor within its type, such as an operator object id.' })
  actorId!: string;

  @ApiProperty({
    description: 'Dotted event name, such as `onboarding.step_submitted`.',
    example: 'onboarding.step_submitted',
  })
  action!: string;

  @ApiProperty({ example: 'onboarding' })
  resourceType!: string;

  @ApiProperty({ description: 'The resource within its type, such as an onboarding id.' })
  resourceId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Event-specific detail; the audit log contract lists the keys per action.',
  })
  metadata!: Record<string, unknown>;
}
