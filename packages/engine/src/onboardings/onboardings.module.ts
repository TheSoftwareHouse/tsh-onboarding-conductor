import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientWebhookOutboxModule } from '../client-webhook-outbox/client-webhook-outbox.module';
import { ClientWebhookUrlResolver } from '../config/client-webhook-url-resolver';
import { StorageModule } from '../storage/storage.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AdminOnboardingsController } from './admin-onboardings.controller';
import { DocumentUploadService } from './document-upload.service';
import { OnboardingDocumentEntity } from './entity/onboarding-document.entity';
import { OnboardingEntity } from './entity/onboarding.entity';
import { OnboardingDocumentsRepository } from './onboarding-documents.repository';
import { OnboardingWebhookService } from './onboarding-webhook/onboarding-webhook.service';
import { OnboardingsController } from './onboardings.controller';
import { OnboardingsRepository } from './onboardings.repository';
import { OnboardingsService } from './onboardings.service';

@Module({
  imports: [
    WorkflowsModule,
    StorageModule,
    ClientWebhookOutboxModule,
    TypeOrmModule.forFeature([OnboardingEntity, OnboardingDocumentEntity]),
  ],
  controllers: [OnboardingsController, AdminOnboardingsController],
  providers: [
    OnboardingsRepository,
    OnboardingDocumentsRepository,
    OnboardingsService,
    DocumentUploadService,
    OnboardingWebhookService,
    ClientWebhookUrlResolver,
  ],
})
export class OnboardingsModule {}
