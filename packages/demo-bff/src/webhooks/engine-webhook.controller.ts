import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';

import { BnplSessionStore } from '../bnpl/bnpl-session.store';
import { StateWaiter } from '../bnpl/state-waiter';

/**
 * Receives the engine's unsigned, at-least-once `onboarding.state_changed`. It is only an
 * accelerator: nothing in the body is trusted beyond the onboarding id, and the waiter re-reads
 * `/state` itself. An unknown onboarding or a redelivery is still a 204, so the engine stops
 * retrying.
 */
@Controller('v1/bnpl/webhooks')
export class EngineWebhookController {
  constructor(
    private readonly store: BnplSessionStore,
    private readonly waiter: StateWaiter,
  ) {}

  @Post('engine')
  @HttpCode(204)
  receive(@Headers('x-webhook-event-id') eventId: string | undefined, @Body() body: unknown): void {
    if (eventId !== undefined && !this.store.claimEvent(eventId)) {
      return;
    }

    const onboardingId = onboardingIdOf(body);
    const session =
      onboardingId === undefined ? undefined : this.store.findByOnboardingId(onboardingId);

    if (onboardingId === undefined || session === undefined) {
      return;
    }

    if (eventId !== undefined) {
      session.lastEventId = eventId;
    }
    this.waiter.wake(onboardingId);
  }
}

function onboardingIdOf(body: unknown): string | undefined {
  const onboarding = (body as { onboarding?: { id?: unknown } } | null)?.onboarding;

  return typeof onboarding?.id === 'string' ? onboarding.id : undefined;
}
