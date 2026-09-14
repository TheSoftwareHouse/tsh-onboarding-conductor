import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgreementsModule } from '../agreements/agreements.module';
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
    // Deferred like `WebhookModule` below, and for the same ring: this module imports
    // `AgreementsModule`, which imports `WebhookModule`, which imports this one back. Whichever
    // of the three a bootstrap reaches first leaves one of the others still half-evaluated, so
    // the class reference has to be read lazily rather than at decorator-evaluation time.
    forwardRef(() => AgreementsModule),
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
