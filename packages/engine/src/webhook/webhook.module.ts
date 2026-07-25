import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientWebhookUrlResolver } from '../config/client-webhook-url-resolver';
import { WebhookOutboxEntity } from './entity/webhook-outbox.entity';
import { WebhookRepository } from './webhook.repository';
import { WebhookService } from './webhook.service';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookOutboxEntity])],
  providers: [WebhookRepository, WebhookService, ClientWebhookUrlResolver],
  exports: [WebhookRepository, WebhookService, ClientWebhookUrlResolver],
})
export class WebhookModule {}
