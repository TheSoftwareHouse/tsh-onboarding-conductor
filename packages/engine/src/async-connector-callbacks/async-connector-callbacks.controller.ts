import { BadRequestException, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { OnboardingsService } from '../onboardings/onboardings.service';
import { AsyncConnectorCallbacksService } from './async-connector-callbacks.service';

@Controller('v1/webhooks')
export class AsyncConnectorCallbacksController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly asyncConnectorCallbacksService: AsyncConnectorCallbacksService,
    private readonly onboardingsService: OnboardingsService,
  ) {}

  @Post(':providerKey/callback')
  @HttpCode(204)
  async receive(@Param('providerKey') providerKey: string, @Req() request: Request): Promise<void> {
    const rawBody = this.extractRawBody(request.body);
    const headers = this.normalizeHeaders(request.headers);

    const normalizedCallback = await this.asyncConnectorCallbacksService.normalizeInboundCallback(
      this.dataSource.manager,
      {
        providerKey,
        rawBody,
        headers,
      },
    );

    await this.onboardingsService.submit(
      normalizedCallback.onboardingId,
      normalizedCallback.submittedData,
      {
        resolvedConnector: normalizedCallback.resolvedConnector,
      },
    );
  }

  private extractRawBody(body: unknown): Uint8Array {
    if (Buffer.isBuffer(body)) {
      return new Uint8Array(body);
    }

    if (body instanceof Uint8Array) {
      return body;
    }

    throw new BadRequestException({
      code: 'ASYNC_CALLBACK_RAW_BODY_REQUIRED',
      message: 'ASYNC_CALLBACK_RAW_BODY_REQUIRED',
    });
  }

  private normalizeHeaders(headers: Request['headers']): Record<string, string | undefined> {
    const normalized: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        normalized[key] = value;
        continue;
      }

      if (Array.isArray(value)) {
        normalized[key] = value[0];
        continue;
      }

      normalized[key] = undefined;
    }

    return normalized;
  }
}
