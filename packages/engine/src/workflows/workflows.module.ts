import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectorsModule } from '../connectors/connectors.module';
import { WorkflowEntity } from './entity/workflow.entity';
import { WorkflowFileLoaderService } from './workflow-file-loader.service';
import { WorkflowRegistryService } from './workflow-registry.service';
import { WorkflowsRepository } from './workflows.repository';

@Module({
  imports: [ConfigModule, ConnectorsModule, TypeOrmModule.forFeature([WorkflowEntity])],
  providers: [WorkflowFileLoaderService, WorkflowsRepository, WorkflowRegistryService],
  exports: [WorkflowRegistryService],
})
export class WorkflowsModule {}
