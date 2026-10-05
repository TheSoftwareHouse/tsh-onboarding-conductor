import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  NormalizedWorkflowConnectorDeclaration,
  NormalizedWorkflowConnectorFallback,
} from '@tsh/ddl-schema';
import type { ConnectorPendingExecution } from '../ports/connector-execution-result';
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
  connector: NormalizedWorkflowConnectorFallback;
  pendingConnector: ConnectorPendingExecution | null;
}>;

export type AwaitingCallbackConnectorResolutionInput = {
  readonly onboardingId: string;
  readonly connectorId: string;
};

/**
 * Resolves the parked connector's declaration and `connectorOrder` for a callback. The park is
 * persisted on the onboarding (`pendingConnector`) and preferred: an operator may switch the
 * step's connector while an onboarding waits, and the callback must still reach the provider the
 * park happened on. An onboarding parked before the record existed falls back to matching the
 * callback's connector against the step's effective chain. `undefined` also doubles as the redelivery guard: once the first delivery has advanced the step, a redelivery
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

    const workflow = await this.workflowRegistryService.getByVersionId(
      onboarding.workflowVersionId,
    );
    const step = workflow.findStep(onboarding.currentStep);

    if (!step) {
      return undefined;
    }

    const pending = onboarding.pendingConnector;

    if (pending) {
      return this.resolvePersisted(onboarding, step.connectors, pending, input.connectorId);
    }

    // Every fallback shares its primary's `order`, so matching against the flattened chain already
    // resolves to the right `connectorOrder` whichever link matched — and to the matched
    // declaration's own `config`, which is what a caller such as a KYC callback handler reads.
    const connector = step.connectors
      .flatMap<NormalizedWorkflowConnectorFallback>((declaration) => [
        declaration,
        ...declaration.fallbacks,
      ])
      .find((candidate) => candidate.id === input.connectorId);

    return connector
      ? { connectorOrder: connector.order, onboarding, connector, pendingConnector: null }
      : undefined;
  }

  private resolvePersisted(
    onboarding: OnboardingEntity,
    declarations: readonly NormalizedWorkflowConnectorDeclaration[],
    pending: ConnectorPendingExecution,
    connectorId: string,
  ): AwaitingCallbackConnectorResolution | undefined {
    if (pending.connectorId !== connectorId) {
      return undefined;
    }

    const slot = declarations.find((declaration) => declaration.order === pending.connectorOrder);

    if (!slot) {
      return undefined;
    }

    // The park happened on the provider the slot named then. When an operator has switched the
    // slot's primary since, that provider is no longer in the chain; the primary's authored
    // config and field mapping are provider-neutral and survive the switch, so they stand in.
    const connector =
      [slot, ...slot.fallbacks].find((candidate) => candidate.id === pending.connectorId) ??
      ({ ...slot, id: pending.connectorId } satisfies NormalizedWorkflowConnectorFallback);

    return {
      connectorOrder: pending.connectorOrder,
      onboarding,
      connector,
      pendingConnector: pending,
    };
  }
}
