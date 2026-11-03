import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { LimitsModule } from '../limits/limits.module';
import { AnalyticsToolsModule } from './analytics/analytics.module';
import { ComplianceToolsModule } from './compliance/compliance.module';
import { OnboardingsToolsModule } from './onboardings/onboardings.module';
import { ToolRegistry } from './tool-registry';
import { WorkflowsToolsModule } from './workflows/workflows.module';

@Module({
  imports: [
    DiscoveryModule,
    AuditModule,
    LimitsModule,
    WorkflowsToolsModule,
    OnboardingsToolsModule,
    AnalyticsToolsModule,
    ComplianceToolsModule,
  ],
  providers: [ToolRegistry],
  exports: [ToolRegistry],
})
export class ToolsModule {}
