import type { InjectionToken } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import {
  ConnectorTier,
  type ConnectorAdapter,
  type ConnectorCallbackMappingInput,
  type ConnectorExecutionInput,
} from '../../src/connectors/ports/connector-adapter.port';
import type {
  ConnectorCallbackResult,
  ConnectorExecutionResult,
} from '../../src/connectors/ports/connector-execution-result';

export type ProductionConnectorStubDefinition = Readonly<{
  /** DI token of the production adapter to stand in for, e.g. `TwilioVerifyConnector`. */
  provider: InjectionToken;
  /**
   * Connector type the workflow declares. It must stay the production type — adapter lookup is a
   * plain match on `declaration.type`, and the workflow registry refuses to load a workflow whose
   * declared type nothing answers to.
   */
  type: string;
  /** Defaults to `type`, matching how the production adapters name themselves. */
  name?: string;
  supportsAsyncCallback?: boolean;
  execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult>;
  validateDeclaration?(declaration: NormalizedWorkflowConnectorDeclaration): void;
  mapCallbackResult?(input: ConnectorCallbackMappingInput): Promise<ConnectorCallbackResult>;
}>;

export type ProductionConnectorStub = ConnectorAdapter &
  Readonly<{
    /** Every input the engine handed to the stub, in execution order. */
    calls: readonly ConnectorExecutionInput[];
    reset(): void;
  }>;

/**
 * Replaces a production connector with an in-test fake so a workflow declaring, say,
 * `twilio_verify` runs without touching the provider. The workflow JSON stays untouched: the stub
 * answers to the same connector type the flow declares.
 *
 * Call it on the builder before `compile()`:
 *
 * ```ts
 * const builder = Test.createTestingModule({ imports: [AppModule] });
 * const twilio = stubProductionConnector(builder, {
 *   provider: TwilioVerifyConnector,
 *   type: 'twilio_verify',
 *   execute: async () => ConnectorExecutionResult.accepted(),
 * });
 * const moduleFixture = await builder.compile();
 * ```
 *
 * This works only for in-process suites. A containerized engine resolves its own adapters, so a
 * flow running there still reaches the real provider.
 */
export const stubProductionConnector = (
  builder: TestingModuleBuilder,
  definition: ProductionConnectorStubDefinition,
): ProductionConnectorStub => {
  const calls: ConnectorExecutionInput[] = [];

  const stub: ProductionConnectorStub = {
    name: definition.name ?? definition.type,
    type: definition.type,
    // ConnectorsModule reads tiers off inject position, not off the instance, so a stub standing in
    // for a production adapter has to declare the production tier or startup fails on a tier
    // mismatch. Callers never get to choose this.
    tier: ConnectorTier.PRODUCTION,
    supportsAsyncCallback: definition.supportsAsyncCallback,
    validateDeclaration: definition.validateDeclaration,
    mapCallbackResult: definition.mapCallbackResult,
    execute: async (input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> => {
      calls.push(input);

      return definition.execute(input);
    },
    calls,
    reset: (): void => {
      calls.length = 0;
    },
  };

  builder.overrideProvider(definition.provider).useValue(stub);

  return stub;
};
