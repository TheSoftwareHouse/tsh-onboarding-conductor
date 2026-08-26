import { Injectable } from '@nestjs/common';
import type {
  ConnectorAdapter,
  ConnectorCallbackMappingInput,
  ConnectorCallbackUnsignedAuth,
  ConnectorExecutionInput,
} from '../../ports/connector-adapter.port';
import {
  type ConnectorCallbackResult,
  type ConnectorRejectionReason,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';
import { ProviderCallbackStore, type ProviderInitiation } from './support/provider-callback.store';

/**
 * Payload prefixes carrying template variables. The mock's own wording comes first; the rest
 * are the spellings of the providers it stands in for, so a workflow written for a real
 * provider needs no edit when CONNECTOR_MOCKS points its type here.
 */
const TEMPLATE_DATA_PREFIXES = ['data.', 'dynamicTemplateData.'];

export type MockDeliveredEmail = Readonly<{
  onboardingId: string;
  stepName: string;
  recipient: string;
  templateId: string;
  data: Readonly<Record<string, unknown>>;
}>;

/**
 * Templated message delivery with nothing leaving the machine. Messages are kept in memory so
 * a test asserts on what the provider would have received. As with the verification mock both
 * drive modes exist: `async: false` settles in `execute`, while `async: true` treats the send
 * as accepted-for-delivery and lets a delivery callback decide.
 */
@Injectable()
export class MockEmailDeliveryConnector implements ConnectorAdapter {
  readonly name = 'mock_email_delivery';
  readonly id = 'mock_email_delivery';
  readonly type = 'email_delivery' as const;
  readonly supportsAsyncCallback = true;
  readonly callbackAuth: ConnectorCallbackUnsignedAuth = {
    kind: 'none',
    justification:
      'Fixture with no upstream provider to share a signing secret with; production ingress additionally requires naming it in CONNECTOR_CALLBACK_UNSIGNED_TYPES, which no deployment should do.',
  };

  private readonly delivered: MockDeliveredEmail[] = [];
  private readonly callbacks = new ProviderCallbackStore<MockDeliveredEmail>();

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const recipient = this.text(input.payload.recipient);
    const templateId = this.text(input.payload.templateId);

    if (!recipient || !templateId) {
      return ConnectorExecutionResult.invalid();
    }

    const message: MockDeliveredEmail = {
      onboardingId: input.execution.onboardingId,
      stepName: input.execution.stepName,
      recipient: recipient.trim(),
      templateId: templateId.trim(),
      data: this.templateData(input.payload),
    };

    this.delivered.push(message);

    if (input.declaration.async === true) {
      // Accepted for delivery; whether it lands is what the callback reports.
      this.callbacks.record({
        onboardingId: message.onboardingId,
        connectorOrder: input.declaration.order,
        detail: message,
      });
    }

    return ConnectorExecutionResult.accepted();
  }

  async mapCallbackResult(input: ConnectorCallbackMappingInput): Promise<ConnectorCallbackResult> {
    const payload = this.callbacks.parseCallback(input.rawBody);
    const initiation = this.callbacks.requireInitiation(payload);

    return {
      onboardingId: initiation.onboardingId,
      submittedData: this.callbacks.requireSubmittedData(payload.submittedData),
      resolvedConnector: { connectorOrder: initiation.connectorOrder },
      result: this.callbackResult(payload),
    };
  }

  private callbackResult(payload: Readonly<Record<string, unknown>>): ConnectorExecutionResult {
    const status = payload.status;

    if (status === undefined || status === 'delivered') {
      return ConnectorExecutionResult.accepted();
    }

    if (status === 'bounced' || status === 'dropped') {
      return ConnectorExecutionResult.rejected(this.reason(payload.reason) ?? 'CONNECTOR_REJECTED');
    }

    throw new Error('status must be one of delivered, bounced, dropped');
  }

  private templateData(payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(payload)) {
      const prefix = TEMPLATE_DATA_PREFIXES.find((candidate) => key.startsWith(candidate));

      if (prefix) {
        data[key.slice(prefix.length)] = typeof value === 'string' ? value.trim() : value;
      }
    }

    return data;
  }

  private text(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  }

  private reason(value: unknown): ConnectorRejectionReason | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (
      value === 'ATTEMPTS_EXHAUSTED' ||
      value === 'CHALLENGE_EXPIRED' ||
      value === 'CHALLENGE_NOT_FOUND' ||
      value === 'CONNECTOR_REJECTED'
    ) {
      return value;
    }

    throw new Error('reason must be a valid ConnectorRejectionReason');
  }

  __peekDeliveredEmailsForTests(onboardingId?: string): readonly MockDeliveredEmail[] {
    return onboardingId
      ? this.delivered.filter((message) => message.onboardingId === onboardingId)
      : [...this.delivered];
  }

  __peekInitiationForTests(
    onboardingId: string,
  ): ProviderInitiation<MockDeliveredEmail> | undefined {
    return this.callbacks.peekLatest(onboardingId);
  }

  __buildProviderCallbackForTests(payload: Readonly<Record<string, unknown>>) {
    return this.callbacks.buildCallback(payload);
  }

  __resetForTests(): void {
    this.delivered.length = 0;
    this.callbacks.reset();
  }
}
