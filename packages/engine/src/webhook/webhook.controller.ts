import { Controller, HttpCode, Inject, Logger, Param, Post, Req, forwardRef } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { markAuditRecorded } from '../audit/audit-recorded.marker';
import { ConnectorNotConfiguredException } from '../connectors/errors/connector-not-configured.exception';
import { ConnectorCallbackAlreadyAppliedError } from '../connectors/errors/connector-callback-already-applied.error';
import { SendgridEmailUnavailableException } from '../connectors/errors/sendgrid-email-unavailable.exception';
import { SumsubUnavailableException } from '../connectors/errors/sumsub-unavailable.exception';
import { TwilioVerifyUnavailableException } from '../connectors/errors/twilio-verify-unavailable.exception';
import { InvalidStepDataException } from '../onboardings/errors/invalid-step-data.exception';
import { OnboardingCompletedException } from '../onboardings/errors/onboarding-completed.exception';
import { OnboardingNotFoundException } from '../onboardings/errors/onboarding-not-found.exception';
import { UnknownWorkflowEvaluationException } from '../onboardings/errors/unknown-workflow-evaluation.exception';
import { OnboardingsService } from '../onboardings/onboardings.service';
import { ApiErrorResponses } from '../openapi/api-error-responses.decorator';
import { API_TAGS } from '../openapi/openapi.constants';
import { WorkflowNotFoundException } from '../workflows/errors/workflow-not-found.exception';
import { WorkflowRetiredException } from '../workflows/errors/workflow-retired.exception';
import { AsyncCallbackAuthenticationFailedException } from './errors/async-callback-authentication-failed.exception';
import { AsyncCallbackProviderKeyInvalidException } from './errors/async-callback-provider-key-invalid.exception';
import { AsyncCallbackRawBodyRequiredException } from './errors/async-callback-raw-body-required.exception';
import { CallbackSignatureInvalidException } from './errors/callback-signature-invalid.exception';
import type { CallbackSignatureRejectionReason } from './errors/callback-signature-invalid.exception';
import { WebhookDeliveryFailedException } from './errors/webhook-delivery-failed.exception';
import { WebhookService } from './webhook.service';

const UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID = 'unresolved';

@ApiTags(API_TAGS.providerCallbacks.name)
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
  @ApiOperation({
    operationId: 'receiveProviderCallback',
    summary: 'Receive a provider callback',
    description:
      "A provider's asynchronous result for a connector step. The engine verifies the HMAC the " +
      'adapter declares over the raw body first, maps the payload to the onboarding it belongs to ' +
      "and to step data, and then submits that data exactly as the flow's submit route would, so " +
      'the same workflow outcomes and the same refusals apply. A replay of a callback already ' +
      'applied is acknowledged and ignored.',
  })
  @ApiParam({
    name: 'providerKey',
    description:
      "The connector adapter's id, the same value a workflow's connector declaration names.",
    example: 'sumsub_kyc',
  })
  @ApiConsumes('*/*')
  @ApiBody({
    description:
      "The provider's payload, byte for byte as the provider sent it: the signature is computed " +
      'over exactly these bytes, so the body is read raw and parsed only after it verifies. The ' +
      'signature and timestamp header names are whatever the connector adapter declares for its ' +
      'provider.',
    schema: { type: 'string' },
  })
  @ApiNoContentResponse({
    description:
      'The result was applied to the onboarding, or had already been applied by an earlier ' +
      'delivery of the same callback.',
  })
  @ApiErrorResponses(
    AsyncCallbackRawBodyRequiredException,
    AsyncCallbackProviderKeyInvalidException,
    AsyncCallbackAuthenticationFailedException,
    InvalidStepDataException,
    {
      exception: CallbackSignatureInvalidException,
      args: ['signature_mismatch'],
      description:
        'The signature could not be verified: the header is missing or malformed, the digest ' +
        'does not match, the timestamp is missing or outside the tolerance, or the connector is ' +
        'not allowed to send unsigned callbacks.',
    },
    {
      exception: CallbackSignatureInvalidException,
      args: ['signing_secret_missing'],
      description:
        'A configuration gap on the engine side: the adapter declares no `callbackAuth`, or its ' +
        'signing secret is not configured. Retry once the connector settings are fixed.',
    },
    ConnectorNotConfiguredException,
    OnboardingNotFoundException,
    WorkflowNotFoundException,
    WorkflowRetiredException,
    OnboardingCompletedException,
    UnknownWorkflowEvaluationException,
    TwilioVerifyUnavailableException,
    SendgridEmailUnavailableException,
    SumsubUnavailableException,
    WebhookDeliveryFailedException,
  )
  async receive(@Param('providerKey') providerKey: string, @Req() request: Request): Promise<void> {
    let rawBody: Uint8Array;

    try {
      rawBody = this.extractRawBody(request.body);
    } catch (error) {
      if (error instanceof AsyncCallbackRawBodyRequiredException) {
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

    throw new AsyncCallbackRawBodyRequiredException();
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

    if (error instanceof AsyncCallbackProviderKeyInvalidException) {
      return 'provider_key_invalid';
    }

    if (error instanceof AsyncCallbackAuthenticationFailedException) {
      return 'authentication_failed';
    }

    return null;
  }
}
