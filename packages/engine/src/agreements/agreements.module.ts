import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OnboardingAgreementStatusView } from '../onboardings/entity/onboarding-agreement-status.view';
import { OnboardingAgreementEntity } from '../onboardings/entity/onboarding-agreement.entity';
import { OnboardingAgreementsRepository } from '../onboardings/onboarding-agreements.repository';
import { WebhookModule } from '../webhook/webhook.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AgreementsController } from './agreements.controller';
import { AgreementsRepository } from './agreements.repository';
import { AgreementsService } from './agreements.service';
import { AgreementEntity } from './entity/agreement.entity';
import { AgreementVersionEntity } from './entity/agreement-version.entity';

@Module({
  imports: [
    AuditModule,
    AuthModule,
    WorkflowsModule,
    // The publish fan-out notifies through the webhook module, which reaches back into the
    // onboardings module, which reaches here. Every side of that ring defers the same way.
    forwardRef(() => WebhookModule),
    // `autoLoadEntities` only picks up what a `forFeature` names, and these are the feature's
    // own: the families, their versions, the links, and the view the derived status is read from.
    TypeOrmModule.forFeature([
      AgreementEntity,
      AgreementVersionEntity,
      OnboardingAgreementEntity,
      OnboardingAgreementStatusView,
    ]),
  ],
  controllers: [AgreementsController],
  providers: [AgreementsRepository, OnboardingAgreementsRepository, AgreementsService],
  exports: [AgreementsService, OnboardingAgreementsRepository],
})
export class AgreementsModule {}
