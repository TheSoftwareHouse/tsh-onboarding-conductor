import { Controller, Get, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from './audit.service';
import { AuditAdminGuard } from './guards/audit-admin.guard';

@Controller('v1/audit')
@UseGuards(AuditAdminGuard)
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async list() {
    return this.auditService.list(this.dataSource.manager);
  }
}
