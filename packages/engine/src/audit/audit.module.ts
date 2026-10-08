import { Module, forwardRef } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ADMIN_ACCESS_AUDIT } from '../auth/admin-access-audit.port';
import { AuthModule } from '../auth/auth.module';
import { AdminAccessAuditAdapter } from './admin-access-audit.adapter';
import { ApiFailureAuditFilter } from './api-failure-audit.filter';
import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { AuditLogEntity } from './entity/audit-log.entity';

import { AuditService } from './audit.service';

@Module({
  // The cycle is real rather than accidental: the audit endpoint is itself guarded, and the guard
  // writes to the audit log. Each module needs the other's provider, so both sides defer.
  imports: [forwardRef(() => AuthModule), TypeOrmModule.forFeature([AuditLogEntity])],
  controllers: [AuditController],
  providers: [
    AuditRepository,
    AuditService,
    { provide: ADMIN_ACCESS_AUDIT, useClass: AdminAccessAuditAdapter },
    // Global despite living in a feature module: `AuditModule` is where `AuditService` lives, and
    // an `APP_FILTER` provider is global to the whole app regardless of which module declares it.
    // The filter is its own provider so a stream's error handler can reach the one instance.
    ApiFailureAuditFilter,
    { provide: APP_FILTER, useExisting: ApiFailureAuditFilter },
  ],
  exports: [AuditRepository, AuditService, ADMIN_ACCESS_AUDIT, ApiFailureAuditFilter],
})
export class AuditModule {}
