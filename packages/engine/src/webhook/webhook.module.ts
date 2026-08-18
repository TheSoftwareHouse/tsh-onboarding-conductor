import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { OnboardingsModule } from '../onboardings/onboardings.module';
import { ClientWebhookUrlResolver } from '../config/client-webhook-url-resolver';
import { CallbackSignatureVerifier } from './callback-signature/callback-signature.verifier';
import { WebhookOutboxEntity } from './entity/webhook-outbox.entity';
import { HttpDeliveryService } from './delivery/http-delivery.service';
import { RetryService } from './retry.service';
import { WebhookController } from './webhook.controller';
import { WebhookQueueService } from './webhook-queue.service';
import { WebhookRepository } from './webhook.repository';
import { WebhookService } from './webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookOutboxEntity]),
    AuditModule,
    ConnectorsModule,
    forwardRef(() => OnboardingsModule),
  ],
  controllers: [WebhookController],
  providers: [
    WebhookRepository,
    WebhookService,
    CallbackSignatureVerifier,
    WebhookQueueService,
    HttpDeliveryService,
    ClientWebhookUrlResolver,
    RetryService,
  ],
  exports: [WebhookRepository, WebhookService, WebhookQueueService, ClientWebhookUrlResolver],
})
export class WebhookModule {}
