import { Module } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module';
import { McpController } from './mcp.controller';

@Module({ imports: [ToolsModule], controllers: [McpController] })
export class TransportModule {}
