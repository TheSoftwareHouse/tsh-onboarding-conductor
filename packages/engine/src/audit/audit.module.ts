import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ADMIN_ACCESS_AUDIT } from '../auth/admin-access-audit.port';
import { AuthModule } from '../auth/auth.module';
import { AdminAccessAuditAdapter } from './admin-access-audit.adapter';
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
  ],
  exports: [AuditRepository, AuditService, ADMIN_ACCESS_AUDIT],
})
export class AuditModule {}
