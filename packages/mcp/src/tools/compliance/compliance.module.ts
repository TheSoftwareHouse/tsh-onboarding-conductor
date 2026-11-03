import { Module } from '@nestjs/common';
import { ClassificationModule } from '../../classification/classification.module';
import { EngineModule } from '../../engine/engine.module';
import { MaskingModule } from '../../masking/masking.module';
import { AccessReportTool } from './access-report.tool';
import { AuditReader } from './audit-reader';
import { SearchAuditTool } from './search-audit.tool';

@Module({
  imports: [EngineModule, MaskingModule, ClassificationModule],
  providers: [AuditReader, SearchAuditTool, AccessReportTool],
})
export class ComplianceToolsModule {}
