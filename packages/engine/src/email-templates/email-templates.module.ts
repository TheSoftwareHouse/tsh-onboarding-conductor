import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailTemplateLoaderService } from './email-template-loader.service';

@Module({
  imports: [ConfigModule],
  providers: [EmailTemplateLoaderService],
  exports: [EmailTemplateLoaderService],
})
export class EmailTemplatesModule {}
