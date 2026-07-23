import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ClientWebhookUrlResolver {
  constructor(private readonly configService: ConfigService) {}

  resolve(path: string): string {
    const baseUrl = this.configService.get<string>('CLIENT_WEBHOOK_BASE_URL');
    if (!baseUrl) {
      throw new Error('CLIENT_WEBHOOK_BASE_URL is required when webhook declaration is configured');
    }

    return new URL(path, baseUrl).toString();
  }
}
