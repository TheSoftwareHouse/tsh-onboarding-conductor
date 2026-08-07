import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Req,
  forwardRef,
} from '@nestjs/common';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { OnboardingsService } from '../onboardings/onboardings.service';
import { WebhookService } from './webhook.service';

const UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID = 'unresolved';

@Controller('v1/webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly webhookService: WebhookService,
    @Inject(forwardRef(() => OnboardingsService))
    private readonly onboardingsService: OnboardingsService,
    private readonly auditService?: AuditService,
  ) {}

  @Post(':providerKey/callback')
  @HttpCode(204)
  async receive(@Param('providerKey') providerKey: string, @Req() request: Request): Promise<void> {
    let rawBody: Uint8Array;

    try {
      rawBody = this.extractRawBody(request.body);
    } catch (error) {
      if (error instanceof BadRequestException) {
        await this.recordInboundWebhookEvent('webhook.inbound_callback_rejected', {
          reason: 'raw_body_required',
        });
      }
      throw error;
    }

    const headers = this.normalizeHeaders(request.headers);
    await this.recordInboundWebhookEvent('webhook.inbound_callback_received', {
      ingress: 'provider_callback',
    });

    let callbackResult: Awaited<ReturnType<WebhookService['process']>>;

    try {
      callbackResult = await this.webhookService.process(this.dataSource.manager, {
        providerKey,
        rawBody,
        headers,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        const reason = this.getRejectionReason(error);
        if (reason) {
          await this.recordInboundWebhookEvent('webhook.inbound_callback_rejected', {
            reason,
          });
        }
      }
      throw error;
    }

    await this.onboardingsService.submit(
      callbackResult.onboardingId,
      callbackResult.submittedData,
      {
        providerIdentity: callbackResult.providerIdentity,
        resolvedConnector: callbackResult.resolvedConnector,
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

  private async recordInboundWebhookEvent(
    action: 'webhook.inbound_callback_received' | 'webhook.inbound_callback_rejected',
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditService) {
      return;
    }

    try {
      await this.auditService.logWebhook(this.dataSource.manager, {
        action,
        resourceType: 'provider_callback',
        resourceId: UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID,
        metadata,
      });
    } catch (error) {
      this.logger.warn(
        `Unable to record inbound callback audit event ${action}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private getRejectionReason(
    error: BadRequestException,
  ): 'provider_key_invalid' | 'authentication_failed' | null {
    const response = error.getResponse();

    if (typeof response === 'object' && response !== null && 'code' in response) {
      const code = response.code;

      if (code === 'ASYNC_CALLBACK_PROVIDER_KEY_INVALID') {
        return 'provider_key_invalid';
      }

      if (code === 'ASYNC_CALLBACK_AUTHENTICATION_FAILED') {
        return 'authentication_failed';
      }
    }

    return null;
  }
}
