import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectorsModule } from '../connectors/connectors.module';
import { OnboardingsModule } from '../onboardings/onboardings.module';
import { ClientWebhookUrlResolver } from '../config/client-webhook-url-resolver';
import { WebhookOutboxEntity } from './entity/webhook-outbox.entity';
import { WebhookController } from './webhook.controller';
import { WebhookRepository } from './webhook.repository';
import { WebhookService } from './webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookOutboxEntity]),
    ConnectorsModule,
    forwardRef(() => OnboardingsModule),
  ],
  controllers: [WebhookController],
  providers: [WebhookRepository, WebhookService, ClientWebhookUrlResolver],
  exports: [WebhookRepository, WebhookService, ClientWebhookUrlResolver],
})
export class WebhookModule {}
