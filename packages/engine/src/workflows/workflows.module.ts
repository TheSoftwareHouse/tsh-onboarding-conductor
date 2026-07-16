import { Module } from '@nestjs/common';
import { WORKFLOW_SOURCE } from '../runtime/onboarding-runtime.port';
import { WorkflowRegistryService } from './workflow-registry.service';

@Module({
  providers: [
    WorkflowRegistryService,
    {
      provide: WORKFLOW_SOURCE,
      useExisting: WorkflowRegistryService,
    },
  ],
  exports: [WorkflowRegistryService, WORKFLOW_SOURCE],
})
export class WorkflowsModule {}
