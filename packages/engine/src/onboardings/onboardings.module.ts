import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectorsModule } from '../connectors/connectors.module';
import { StorageModule } from '../storage/storage.module';
import { WebhookModule } from '../webhook/webhook.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { DocumentUploadService } from './document-upload.service';
import { OnboardingDocumentEntity } from './entity/onboarding-document.entity';
import { OnboardingEntity } from './entity/onboarding.entity';
import { OnboardingDocumentsRepository } from './onboarding-documents.repository';
import { OnboardingsController } from './onboardings.controller';
import { OnboardingsRepository } from './onboardings.repository';
import { OnboardingsService } from './onboardings.service';

@Module({
  imports: [
    WorkflowsModule,
    ConnectorsModule,
    StorageModule,
    forwardRef(() => WebhookModule),
    TypeOrmModule.forFeature([OnboardingEntity, OnboardingDocumentEntity]),
  ],
  controllers: [OnboardingsController],
  providers: [
    OnboardingsRepository,
    OnboardingDocumentsRepository,
    OnboardingsService,
    DocumentUploadService,
  ],
  exports: [OnboardingsService],
})
export class OnboardingsModule {}
