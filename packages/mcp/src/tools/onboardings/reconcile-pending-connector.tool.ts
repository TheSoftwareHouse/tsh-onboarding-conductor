import { Injectable } from '@nestjs/common';
import type { components } from '@tsh/openapi';
import {
  CONFIRMATION_TOKEN_ARGUMENT,
  CONFIRMATION_TTL_MINUTES,
  ConfirmationService,
} from '../../confirmation/confirmation.service';
import { EngineClient } from '../../engine/engine-client';
import { RequestContext } from '../../request-context/request-context';
import { ToolError } from '../tool-error';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from '../tool-registration';
import { toOnboardingSummary } from './onboarding-summary';
import { getOnboardingId } from './onboarding-arguments';

type ReconcileOutcome = components['schemas']['PendingConnectorReconcileOutcome'];

const OUTCOME_MEANING: Record<ReconcileOutcome, string> = {
  applied: 'The provider held a verdict and the engine applied it; the onboarding has moved on.',
  still_pending: 'The provider has not decided yet; nothing changed.',
  superseded: 'The onboarding had already left that park; nothing changed.',
};

/**
 * Asks the engine to read a parked connector's verdict back from its provider. It changes an
 * onboarding only after a two-step confirmation: the first call is a preview that issues a token,
 * the second redeems it.
 */
@McpTool()
@Injectable()
export class ReconcilePendingConnectorTool implements ToolRegistration {
  readonly kind = ToolKind.WRITE;
  readonly name = 'reconcile_pending_connector';
  readonly description =
    'Asks the identity provider for the verdict of an onboarding that is parked waiting for a ' +
    'provider callback, and applies it as the callback would have. Only for onboardings with a ' +
    'pending connector (find_onboardings parked=true). Two steps: call with only ' +
    'onboardingId to get a preview (status, step, pending connector, parked-since time) and a ' +
    'confirmationToken; show the preview to the analyst and ask whether to proceed; only after ' +
    'they say yes, call again with the same onboardingId and the token. Without a token nothing ' +
    'changes. The reconcile is recorded in the engine audit trail under the analyst. The result ' +
    'is `applied`, `still_pending` or `superseded`.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      onboardingId: { type: 'string', description: 'The parked onboarding UUID.' },
      [CONFIRMATION_TOKEN_ARGUMENT]: {
        type: 'string',
        description:
          'The token from the preview. Omit it on the first call; pass it only after the analyst confirmed.',
      },
    },
    required: ['onboardingId'],
    additionalProperties: false,
  };

  constructor(
    private readonly engine: EngineClient,
    private readonly confirmation: ConfirmationService,
  ) {}

  async handler(args: ToolArguments, context: RequestContext): Promise<object> {
    const onboardingId = getOnboardingId(args);
    // What the token binds: the onboarding, nothing the model might add.
    const bound = { onboardingId };

    if (args[CONFIRMATION_TOKEN_ARGUMENT] === undefined) {
      return this.preview(bound, context);
    }

    this.confirmation.consume(
      context.identity,
      this.name,
      bound,
      args[CONFIRMATION_TOKEN_ARGUMENT],
    );
    const result = await this.engine.request(
      'post',
      '/v1/onboardings/{id}/pending-connector/reconcile',
      context,
      { path: { id: onboardingId } },
    );

    return {
      outcome: result.outcome,
      meaning: OUTCOME_MEANING[result.outcome],
      onboarding: toOnboardingSummary(result.onboarding),
    };
  }

  private async preview(bound: { onboardingId: string }, context: RequestContext): Promise<object> {
    const onboarding = toOnboardingSummary(
      await this.engine.request('get', '/v1/onboardings/{id}', context, {
        path: { id: bound.onboardingId },
      }),
    );

    if (onboarding.pendingConnector === null) {
      throw new ToolError(
        `Onboarding ${onboarding.onboardingId} is not parked on a provider callback (status ${onboarding.status}, step ${onboarding.currentStep ?? 'none'}), so there is nothing to reconcile.`,
      );
    }

    return {
      confirmationRequired: true,
      onboarding,
      pendingConnector: onboarding.pendingConnector,
      parkedSince: onboarding.pendingConnector.parkedAt,
      effect:
        'Asks the provider for the verdict it holds and, if there is one, applies it to this onboarding exactly as the callback would have. The engine audits the action under your name.',
      confirmationToken: this.confirmation.issue(context.identity, this.name, bound),
      confirmationTtlMinutes: CONFIRMATION_TTL_MINUTES,
      next: 'Show this preview to the analyst. Only if they confirm, call again with the same onboardingId and this confirmationToken.',
    };
  }
}
