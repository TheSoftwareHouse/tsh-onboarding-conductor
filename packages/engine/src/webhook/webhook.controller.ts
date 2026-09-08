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
import { markAuditRecorded } from '../audit/audit-recorded.marker';
import { ConnectorCallbackAlreadyAppliedError } from '../connectors/errors/connector-callback-already-applied.error';
import { OnboardingsService } from '../onboardings/onboardings.service';
import { CallbackSignatureInvalidException } from './errors/callback-signature-invalid.exception';
import type { CallbackSignatureRejectionReason } from './errors/callback-signature-invalid.exception';
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
        const recorded = await this.recordInboundWebhookEvent('webhook.inbound_callback_rejected', {
          reason: 'raw_body_required',
        });
        throw recorded ? markAuditRecorded(error) : error;
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
      if (error instanceof ConnectorCallbackAlreadyAppliedError) {
        await this.recordInboundWebhookEvent('webhook.inbound_callback_rejected', {
          reason: 'callback_already_applied',
        });
        return;
      }

      const reason = this.getRejectionReason(error);
      if (reason) {
        const recorded = await this.recordInboundWebhookEvent('webhook.inbound_callback_rejected', {
          reason,
        });
        throw recorded ? markAuditRecorded(error) : error;
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

  /** Best effort only; the caller decides whether to mark the eventual throw as audited. */
  private async recordInboundWebhookEvent(
    action: 'webhook.inbound_callback_received' | 'webhook.inbound_callback_rejected',
    metadata: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.auditService) {
      return false;
    }

    try {
      await this.auditService.logWebhook(this.dataSource.manager, {
        action,
        resourceType: 'provider_callback',
        resourceId: UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID,
        metadata,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Unable to record inbound callback audit event ${action}`,
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    }
  }

  private getRejectionReason(
    error: unknown,
  ): CallbackSignatureRejectionReason | 'provider_key_invalid' | 'authentication_failed' | null {
    if (error instanceof CallbackSignatureInvalidException) {
      return error.reason;
    }

    if (!(error instanceof BadRequestException)) {
      return null;
    }

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
