import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AdminOnboardingsController } from './admin-onboardings.controller';
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
    StorageModule,
    TypeOrmModule.forFeature([OnboardingEntity, OnboardingDocumentEntity]),
  ],
  controllers: [OnboardingsController, AdminOnboardingsController],
  providers: [
    OnboardingsRepository,
    OnboardingDocumentsRepository,
    OnboardingsService,
    DocumentUploadService,
  ],
})
export class OnboardingsModule {}
