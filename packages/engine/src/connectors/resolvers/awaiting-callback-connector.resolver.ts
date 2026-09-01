import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import { OnboardingEntity } from '../../onboardings/entity/onboarding.entity';
import { WorkflowRegistryService } from '../../workflows/workflow-registry.service';

/**
 * Everything a callback handler needs about the connector its onboarding is currently parked on:
 * the order for `ConnectorExecutionResult.pending()`, the onboarding entity the lookup already
 * loaded, and the matching connector declaration (so a caller needing its `config` — Sumsub's
 * `maxAttemptsPerDocSet`, for instance — does not have to repeat this same resolution).
 */
export type AwaitingCallbackConnectorResolution = Readonly<{
  connectorOrder: number;
  onboarding: OnboardingEntity;
  connector: NormalizedWorkflowConnectorDeclaration;
}>;

export type AwaitingCallbackConnectorResolutionInput = {
  readonly onboardingId: string;
  readonly connectorId: string;
};

/**
 * Derives the parked connector's declaration and `connectorOrder` for a callback from data the
 * engine already holds — the parked connector itself is never persisted. `undefined` also
 * doubles as the redelivery guard: once the first delivery has advanced the step, a redelivery
 * no longer finds the connector on the current step and resolves to `undefined` instead of
 * erroring.
 */
@Injectable()
export class AwaitingCallbackConnectorResolver {
  constructor(
    @InjectRepository(OnboardingEntity)
    private readonly onboardingsRepository: Repository<OnboardingEntity>,
    /**
     * `forwardRef` at the parameter level: this resolver is a dependency of `SumsubKycConnector`,
     * one of `CONNECTOR_ADAPTER_COLLECTION`'s members, and `WorkflowRegistryService` optionally
     * injects `WORKFLOW_CONNECTOR_EXECUTION_PORT`, which resolves back to that same collection —
     * a genuine provider-level cycle. Without deferring this token, Nest's DI hangs on it rather
     * than erroring.
     */
    @Inject(forwardRef(() => WorkflowRegistryService))
    private readonly workflowRegistryService: WorkflowRegistryService,
  ) {}

  async findConnector(
    input: AwaitingCallbackConnectorResolutionInput,
  ): Promise<AwaitingCallbackConnectorResolution | undefined> {
    const onboarding = await this.onboardingsRepository.findOne({
      where: { id: input.onboardingId },
    });

    if (!onboarding || onboarding.isApproved() || onboarding.isCompleted()) {
      return undefined;
    }

    if (onboarding.currentStep === null) {
      return undefined;
    }

    const workflow = await this.workflowRegistryService.getById(
      onboarding.workflowId,
      onboarding.workflowVersion,
    );
    const step = workflow.findStep(onboarding.currentStep);

    if (!step) {
      return undefined;
    }

    // A fallback shares its primary's `order`, so matching against the flattened list already
    // resolves to the right `connectorOrder` whichever of the two matched — and to the matched
    // declaration's own `config`, which is what a caller such as Sumsub's callback handler reads.
    const connector = step.connectors
      .flatMap((declaration) =>
        declaration.fallback ? [declaration, declaration.fallback] : [declaration],
      )
      .find((candidate) => candidate.id === input.connectorId);

    return connector ? { connectorOrder: connector.order, onboarding, connector } : undefined;
  }
}
