import { Module } from '@nestjs/common';
import { ToolLimits } from './tool-limits';

@Module({ providers: [ToolLimits], exports: [ToolLimits] })
export class LimitsModule {}
