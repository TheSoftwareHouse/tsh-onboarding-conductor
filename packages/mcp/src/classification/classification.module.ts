import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { MaskingModule } from '../masking/masking.module';
import { FieldClassLookup } from './field-class-lookup';

@Module({
  imports: [EngineModule, MaskingModule],
  providers: [FieldClassLookup],
  exports: [FieldClassLookup],
})
export class ClassificationModule {}
