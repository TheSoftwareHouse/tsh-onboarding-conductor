import { Module } from '@nestjs/common';
import { ToolCallAudit } from './tool-call-audit';

@Module({ providers: [ToolCallAudit], exports: [ToolCallAudit] })
export class AuditModule {}
