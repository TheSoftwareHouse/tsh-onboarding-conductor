import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FieldClassifier, parsePassFields } from './field-classifier';
import { Masker } from './masker';

@Module({
  providers: [
    {
      provide: FieldClassifier,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new FieldClassifier(parsePassFields(config.getOrThrow<string>('MCP_MASKING_PASS_FIELDS'))),
    },
    {
      provide: Masker,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Masker(config.getOrThrow<string>('MCP_MASKING_KEY')),
    },
  ],
  exports: [FieldClassifier, Masker],
})
export class MaskingModule {}
