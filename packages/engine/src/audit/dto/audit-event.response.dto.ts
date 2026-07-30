export class AuditEventResponseDto {
  id!: string;
  occurredAt!: Date;
  actorType!: string;
  actorId!: string;
  action!: string;
  resourceType!: string;
  resourceId!: string;
  metadata!: Record<string, unknown>;
}
