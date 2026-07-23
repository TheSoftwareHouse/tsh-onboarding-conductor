import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientWebhookNotifyService } from './client-webhook-notify.service';
import { ClientWebhookOutboxRepository } from './client-webhook-outbox.repository';
import { ClientWebhookOutboxEntity } from './entity/client-webhook-outbox.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ClientWebhookOutboxEntity])],
  providers: [ClientWebhookOutboxRepository, ClientWebhookNotifyService],
  exports: [ClientWebhookOutboxRepository, ClientWebhookNotifyService],
})
export class ClientWebhookOutboxModule {}
