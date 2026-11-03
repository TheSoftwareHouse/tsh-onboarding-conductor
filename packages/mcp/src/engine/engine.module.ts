import { Module } from '@nestjs/common';
import { EngineClient } from './engine-client';

@Module({ providers: [EngineClient], exports: [EngineClient] })
export class EngineModule {}
