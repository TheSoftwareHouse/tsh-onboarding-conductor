import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { OnboardingsModule } from '../onboardings/onboardings.module';
import { AsyncConnectorCallbacksController } from './async-connector-callbacks.controller';
import { AsyncConnectorCallbacksService } from './async-connector-callbacks.service';

@Module({
  imports: [ConnectorsModule, OnboardingsModule],
  controllers: [AsyncConnectorCallbacksController],
  providers: [AsyncConnectorCallbacksService],
  exports: [AsyncConnectorCallbacksService],
})
export class AsyncConnectorCallbacksModule {}
