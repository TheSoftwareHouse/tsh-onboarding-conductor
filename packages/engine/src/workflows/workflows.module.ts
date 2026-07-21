import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { WorkflowRegistryService } from './workflow-registry.service';

@Module({
  imports: [ConnectorsModule],
  providers: [WorkflowRegistryService],
  exports: [WorkflowRegistryService],
})
export class WorkflowsModule {}
