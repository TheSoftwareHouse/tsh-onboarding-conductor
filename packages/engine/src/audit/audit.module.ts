import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { AuditLogEntity } from './entity/audit-log.entity';

import { AuditService } from './audit.service';
import { AuditAdminGuard } from './guards/audit-admin.guard';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([AuditLogEntity])],
  controllers: [AuditController],
  providers: [AuditRepository, AuditService, AuditAdminGuard],
  exports: [AuditRepository, AuditService, AuditAdminGuard],
})
export class AuditModule {}
