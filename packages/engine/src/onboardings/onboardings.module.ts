import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { StorageModule } from '../storage/storage.module';
import { WebhookModule } from '../webhook/webhook.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { DocumentUploadService } from './document-upload.service';
import { OnboardingDocumentEntity } from './entity/onboarding-document.entity';
import { OnboardingEntity } from './entity/onboarding.entity';
import { OnboardingDocumentsRepository } from './onboarding-documents.repository';
import { OnboardingStateService } from './onboarding-state.service';
import { OnboardingTransitionsService } from './onboarding-transitions.service';
import { OnboardingsController } from './onboardings.controller';
import { OnboardingsRepository } from './onboardings.repository';
import { OnboardingsService } from './onboardings.service';
import { UnsupportedManualReviewActionPipe } from './transport/unsupported-manual-review-action.pipe';

@Module({
  imports: [
    AuditModule,
    AuthModule,
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
    OnboardingStateService,
    OnboardingTransitionsService,
    DocumentUploadService,
    UnsupportedManualReviewActionPipe,
  ],
  exports: [OnboardingsService],
})
export class OnboardingsModule {}
