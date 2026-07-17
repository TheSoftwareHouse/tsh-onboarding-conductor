import { Module } from '@nestjs/common';
import { WorkflowRegistryService } from './workflow-registry.service';

@Module({
  providers: [WorkflowRegistryService],
  exports: [WorkflowRegistryService],
})
export class WorkflowsModule {}
