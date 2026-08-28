import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { WorkflowEntity } from './entity/workflow.entity';
import { WorkflowFileLoaderService } from './workflow-file-loader.service';
import { WorkflowRegistryService } from './workflow-registry.service';
import { WorkflowsRepository } from './workflows.repository';
import { WorkflowsController } from './workflows.controller';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => ConnectorsModule),
    AuditModule,
    forwardRef(() => AuthModule),
    TypeOrmModule.forFeature([WorkflowEntity]),
  ],
  controllers: [WorkflowsController],
  providers: [WorkflowFileLoaderService, WorkflowsRepository, WorkflowRegistryService],
  exports: [WorkflowRegistryService],
})
export class WorkflowsModule {}
