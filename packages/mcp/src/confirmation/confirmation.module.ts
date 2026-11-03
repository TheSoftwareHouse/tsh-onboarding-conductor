import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfirmationService } from './confirmation.service';

@Module({
  providers: [
    {
      provide: ConfirmationService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new ConfirmationService(config.getOrThrow<string>('MCP_MASKING_KEY')),
    },
  ],
  exports: [ConfirmationService],
})
export class ConfirmationModule {}
